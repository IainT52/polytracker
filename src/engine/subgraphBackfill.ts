import { db, setupDbSync } from '../db';
import { trades, wallets, markets } from '../db/schema';
import { eq, desc, like } from 'drizzle-orm';
import { processTradeForFilter } from '../services/filterService';

const GOLDSKY_URL = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/polymarket-orderbook-resync/prod/gn';

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 5, baseDelay = 1000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err: any) {
      const errMsg = err?.message || String(err || '');
      if (errMsg.includes('SQLITE_BUSY') && attempt < maxRetries) {
        attempt++;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[Subgraph] ⏳ SQLITE_BUSY lock detected. Retrying operation in ${Math.round(delay)}ms (Attempt ${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

async function fetchSubgraphTrades(tokenIds: string[], beforeTimestamp?: string, limit = 500) {
  const tokenIdsStr = JSON.stringify(tokenIds);
  let whereClause = `or: [{ makerAssetId_in: ${tokenIdsStr} }, { takerAssetId_in: ${tokenIdsStr} }]`;

  if (beforeTimestamp) {
    whereClause = `or: [
      { makerAssetId_in: ${tokenIdsStr}, timestamp_lt: "${beforeTimestamp}" },
      { takerAssetId_in: ${tokenIdsStr}, timestamp_lt: "${beforeTimestamp}" }
    ]`;
  }

  const query = `
    query GetTrades {
      orderFilledEvents(
        where: { ${whereClause} }
        orderBy: timestamp
        orderDirection: desc
        first: ${limit}
      ) {
        id
        transactionHash
        maker { id }
        taker { id }
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
        timestamp
      }
    }
  `;

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(GOLDSKY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Goldsky API Error: ${response.status} ${response.statusText}`);
      }

      const { data, errors } = await response.json();

      if (errors) {
        const errorMsg = JSON.stringify(errors);
        if (errorMsg.includes('Query timed out')) {
          throw new Error('GOLDSKY_TIMEOUT');
        }
        console.error('[Subgraph] GraphQL Errors:', errors);
        throw new Error('GraphQL queried returned errors');
      }

      return data?.orderFilledEvents || [];
    } catch (e: any) {
      if (e.message === 'GOLDSKY_TIMEOUT') throw e; // Let backfillMarket handle batch sizing
      retries--;
      if (retries === 0) throw e;
      await new Promise(res => setTimeout(res, 2000));
    }
  }
}

export async function backfillMarket(conditionId: string) {
  console.log(`[Subgraph] Starting Goldsky History Backfill for ${conditionId}...`);

  // 1. Fetch market metadata to map outcome indices
  const market = await db.select().from(markets).where(eq(markets.conditionId, conditionId)).get();

  if (!market) {
    console.error(`[Subgraph] Market ${conditionId} not found in local DB. Please let the historicalScraper discover it first.`);
    return;
  }

  let tokenIds = JSON.parse(market.clobTokenIds || '[]');

  // Phase 24: Self-Healing Logic for Missing Tokens
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    console.log(`[Subgraph] Missing CLOB token IDs for ${conditionId}. Attempting self-healing...`);
    try {
      const res = await fetch(`https://clob.polymarket.com/markets/${conditionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.tokens && data.tokens.length > 0) {
          tokenIds = data.tokens.map((t: any) => t.token_id);
          await db.update(markets).set({ clobTokenIds: JSON.stringify(tokenIds) }).where(eq(markets.conditionId, conditionId));
          console.log(`[Subgraph] ✅ Successfully repaired missing token IDs for ${conditionId}`);
        }
      }
    } catch (e) {
      console.error(`[Subgraph] Self-healing fetch failed for ${conditionId}:`, e);
    }
  }

  // Final fallback
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
    console.error(`[Subgraph] Market ${conditionId} STILL has no CLOB token IDs mapped. Cannot align outcomes.`);
    return;
  }

  let beforeTimestamp: string | undefined = undefined;
  let totalIngested = 0;
  let currentBatchSize = 400; // Phase 46: Start conservative to avoid timeouts

  while (true) {
    console.log(`[Subgraph] Fetching up to ${currentBatchSize} prior trades${beforeTimestamp ? ` before ${beforeTimestamp}` : ' from present'}...`);
    let tradesList;
    try {
      tradesList = await fetchSubgraphTrades(tokenIds, beforeTimestamp, currentBatchSize);
    } catch (e: any) {
      if (e.message === 'GOLDSKY_TIMEOUT') {
        if (currentBatchSize <= 50) {
          console.error(`[Subgraph] ❌ Query timed out even at batch size ${currentBatchSize}. Skipping market ${conditionId}.`);
          return;
        }
        currentBatchSize = Math.floor(currentBatchSize / 2);
        console.warn(`[Subgraph] ⏳ Goldsky Timeout! Reducing batch size to ${currentBatchSize} and retrying...`);
        continue;
      }
      throw e;
    }

    // Adaptive increase: if we are successful at a small batch, try to ramp back up slowly if needed
    // (though for backfill, staying conservative is often safer)
    
    if (tradesList.length === 0) {
      console.log(`[Subgraph] Completed backfill for ${conditionId}. Reached beginning of time.`);
      break;
    }

    const uniqueWalletsFound = new Set<string>();
    const validTradesToInsert: any[] = [];

    // 2. Validate and Map
    for (const raw of tradesList) {
      const takerAddr = raw.taker?.id || raw.taker;
      const makerAddr = raw.maker?.id || raw.maker;

      if (!takerAddr || !raw.transactionHash) {
        continue;
      }

      // Ensure case-insensitive matching against token IDs
      const normTokenIds = tokenIds.map((t: any) => t.toString().toLowerCase());
      const makerId = raw.makerAssetId ? raw.makerAssetId.toString().toLowerCase() : "";
      const takerId = raw.takerAssetId ? raw.takerAssetId.toString().toLowerCase() : "";
      const makerIsOutcome = normTokenIds.includes(makerId);
      const takerIsOutcome = normTokenIds.includes(takerId);
      let sharesRaw, usdcRaw, outcomeAssetId;
      let side: "BUY" | "SELL" = "BUY";

      if (makerIsOutcome) {
        outcomeAssetId = raw.makerAssetId;
        sharesRaw = raw.makerAmountFilled;
        usdcRaw = raw.takerAmountFilled;
        side = "BUY"; // Taker is buying outcome tokens from Maker
      } else if (takerIsOutcome) {
        outcomeAssetId = raw.takerAssetId;
        sharesRaw = raw.takerAmountFilled;
        usdcRaw = raw.makerAmountFilled;
        side = "SELL"; // Taker is selling outcome tokens to Maker
      } else {
        // If neither token matches our DB (e.g. an LP providing collateral), skip it
        continue;
      }

      if (!sharesRaw || !usdcRaw || Number(sharesRaw) === 0) {
        continue;
      }

      const tradeData = {
        id: raw.id,
        transactionHash: raw.transactionHash,
        taker: takerAddr,
        maker: makerAddr,
        timestamp: raw.timestamp.toString(),
        asset_id: outcomeAssetId,
        size: (Number(sharesRaw) / 1000000).toString(),
        price: (Number(usdcRaw) / Number(sharesRaw)).toString(),
        side
      };

      const isValid = await processTradeForFilter(tradeData as any, true);

      if (isValid) {
        const mappedOutcome = tokenIds.indexOf(tradeData.asset_id);
        const finalOutcome = mappedOutcome !== -1 ? mappedOutcome : 0;

        validTradesToInsert.push({
          marketId: market.id,
          outcomeIndex: finalOutcome,
          action: tradeData.side.toUpperCase(),
          price: parseFloat(tradeData.price),
          shares: parseFloat(tradeData.size),
          timestamp: new Date(parseInt(tradeData.timestamp) * 1000),
          transactionHash: tradeData.transactionHash,
          _tempWalletAddr: tradeData.taker.toLowerCase()
        });

        uniqueWalletsFound.add(tradeData.taker.toLowerCase());
      }
    }

    if (validTradesToInsert.length > 0) {
      // 3. Insert Wallets
      const walletWrites = Array.from(uniqueWalletsFound).map(address => ({ address }));
      const WALLET_CHUNK = 100;
      for (let i = 0; i < walletWrites.length; i += WALLET_CHUNK) {
        await withRetry(() =>
          db.insert(wallets)
            .values(walletWrites.slice(i, i + WALLET_CHUNK))
            .onConflictDoNothing({ target: wallets.address })
        );
        await new Promise(r => setTimeout(r, 50)); // Prevent SQLITE_BUSY locks
      }

      // 4. Fetch DB Wallet IDs for mapping
      const dbWallets = await db.select({ id: wallets.id, address: wallets.address })
        .from(wallets)
        .all(); // Since we are isolated in a script, it's ok to fetch all. For scale, we'd chunk ‘inArray’

      const walletMap = new Map();
      for (const w of dbWallets) {
        walletMap.set(w.address, w.id);
      }

      // 5. Finalize Trades mapped payload
      const mappedTradePayloads = validTradesToInsert.map(t => {
        return {
          walletId: walletMap.get(t._tempWalletAddr)!,
          marketId: t.marketId,
          outcomeIndex: t.outcomeIndex,
          action: t.action,
          price: t.price,
          shares: t.shares,
          timestamp: t.timestamp,
          transactionHash: t.transactionHash
        };
      }).filter(t => t.walletId !== undefined);

      // 6. DB Bulk Insert using native SQLite batch chunking (Phase 19 stability)
      const TRADES_CHUNK = 100;
      for (let i = 0; i < mappedTradePayloads.length; i += TRADES_CHUNK) {
        const chunk = mappedTradePayloads.slice(i, i + TRADES_CHUNK);
        await withRetry(() =>
          db.insert(trades).values(chunk).onConflictDoNothing({ target: trades.transactionHash })
        );
        await new Promise(r => setTimeout(r, 50)); // Release event loop
      }

      totalIngested += mappedTradePayloads.length;
      console.log(`[Subgraph] Inserted ${mappedTradePayloads.length} delta trades...`);
    }

    // Subgraph requires us to set the 'beforeTimestamp' to the OLDEST trade in this block
    // to walk backward in time
    const oldestTradeInBlock = tradesList[tradesList.length - 1];
    beforeTimestamp = oldestTradeInBlock.timestamp.toString();

    // Phase 46: Throttled delay to prevent overwhelming Goldsky
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Subgraph] 🎉 Successfully ingested ${totalIngested} total historical trades backfilled from Goldsky.`);
}

// -----------------------------------------------------
// Phase 23: Auto-Targeting Backfill Functions
// -----------------------------------------------------
export async function autoBackfillTopMarkets(limit: number) {
  console.log(`[Subgraph] Auto-Targeting Top ${limit} Markets by Volume...`);
  const topMarkets = await db.select().from(markets).orderBy(desc(markets.volume)).limit(limit).all();

  let current = 1;
  const total = topMarkets.length;
  for (const market of topMarkets) {
    console.log(`\n=> Preparing to backfill [${current}/${total}]: ${market.question} (Vol: $${market.volume?.toLocaleString()})`);
    await backfillMarket(market.conditionId);
    current++;
  }
}

export async function autoBackfillKeywordMarkets(keyword: string, limit: number) {
  console.log(`[Subgraph] Auto-Targeting Top ${limit} Markets matching "${keyword}"...`);
  const matchedMarkets = await db.select()
    .from(markets)
    .where(like(markets.question, `%${keyword}%`))
    .orderBy(desc(markets.volume))
    .limit(limit)
    .all();

  if (matchedMarkets.length === 0) {
    console.log(`[Subgraph] No markets found matching keyword: ${keyword}`);
    return;
  }

  let current = 1;
  const total = matchedMarkets.length;
  for (const market of matchedMarkets) {
    console.log(`\n=> Preparing to backfill [${current}/${total}]: ${market.question} (Vol: $${market.volume?.toLocaleString()})`);
    await backfillMarket(market.conditionId);
    current++;
  }
}

// -----------------------------------------------------
// Manual Execution Block
// Use: 
//   npx tsx src/engine/subgraphBackfill.ts <conditionId>
//   npx tsx src/engine/subgraphBackfill.ts --auto [limit]
//   npx tsx src/engine/subgraphBackfill.ts --keyword <keyword> [limit]
// -----------------------------------------------------
if (require.main === module) {
  const flag = process.argv[2];

  setupDbSync().then(() => {
    if (flag === '--auto') {
      const limit = parseInt(process.argv[3] || '10');
      autoBackfillTopMarkets(limit)
        .then(() => {
          console.log('Finished auto backfill sequence.');
          process.exit(0);
        })
        .catch((err) => {
          console.error('Fatal subgraph error:', err);
          process.exit(1);
        });
    } else if (flag === '--keyword') {
      const keyword = process.argv[3];
      const limit = parseInt(process.argv[4] || '10');

      if (!keyword) {
        console.error('Usage: npx tsx src/engine/subgraphBackfill.ts --keyword <keyword> [limit]');
        process.exit(1);
      }

      autoBackfillKeywordMarkets(keyword, limit)
        .then(() => {
          console.log('Finished keyword backfill sequence.');
          process.exit(0);
        })
        .catch((err) => {
          console.error('Fatal subgraph error:', err);
          process.exit(1);
        });
    } else {
      // Original explicit condition ID behavior
      const targetConditionId = flag;
      if (!targetConditionId || !targetConditionId.startsWith('0x')) {
        console.error('Usage: \n  npx tsx src/engine/subgraphBackfill.ts <0xConditionId>\n  npx tsx src/engine/subgraphBackfill.ts --auto [limit]\n  npx tsx src/engine/subgraphBackfill.ts --keyword <keyword> [limit]');
        process.exit(1);
      }

      backfillMarket(targetConditionId)
        .then(() => {
          console.log('Finished standalone backfill script.');
          process.exit(0);
        })
        .catch((err) => {
          console.error('Fatal subgraph error:', err);
          process.exit(1);
        });
    }
  }).catch(err => {
    console.error('Failed to initialize DB sync:', err);
    process.exit(1);
  });
}
