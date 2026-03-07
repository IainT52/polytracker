import { db } from '../db';
import { trades, wallets, markets } from '../db/schema';
import { eq, desc, like } from 'drizzle-orm';
import { processTradeForFilter } from '../services/filterService';

const GOLDSKY_URL = 'https://api.goldsky.com/api/public/project_clpb1tzpe08te01s95w1q6tso/subgraphs/polymarket-orderbook/1.0.0/gn';

async function fetchSubgraphTrades(marketId: string, beforeTimestamp?: string) {
  let whereClause = `market: "${marketId}"`;
  if (beforeTimestamp) {
    whereClause += `, timestamp_lt: "${beforeTimestamp}"`;
  }

  const query = `
    query GetTrades {
      transactions(
        where: { ${whereClause} }
        orderBy: timestamp
        orderDirection: desc
        first: 1000
      ) {
        id
        hash
        taker
        price
        size
        side
        timestamp
        asset_id
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
        console.error('[Subgraph] GraphQL Errors:', errors);
        throw new Error('GraphQL queried returned errors');
      }

      return data?.transactions || [];
    } catch (e) {
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

  while (true) {
    console.log(`[Subgraph] Fetching up to 1000 prior trades${beforeTimestamp ? ` before ${beforeTimestamp}` : ' from present'}...`);
    const tradesList = await fetchSubgraphTrades(conditionId, beforeTimestamp);

    if (tradesList.length === 0) {
      console.log(`[Subgraph] Completed backfill for ${conditionId}. Reached beginning of time.`);
      break;
    }

    const uniqueWalletsFound = new Set<string>();
    const validTradesToInsert: any[] = [];

    // 2. Validate and Map
    for (const tradeData of tradesList) {
      if (!tradeData.taker || !tradeData.hash) continue;

      // Ensure timestamp format aligns perfectly
      tradeData.timestamp = tradeData.timestamp.toString();

      const isValid = await processTradeForFilter(tradeData, true);
      
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
          transactionHash: tradeData.hash,
          _tempWalletAddr: tradeData.taker.toLowerCase()
        });

        uniqueWalletsFound.add(tradeData.taker.toLowerCase());
      }
    }

    if (validTradesToInsert.length > 0) {
      // 3. Insert Wallets
      const walletWrites = Array.from(uniqueWalletsFound).map(address => ({ address }));
      const WALLET_CHUNK = 500;
      for (let i = 0; i < walletWrites.length; i += WALLET_CHUNK) {
        await db.insert(wallets)
          .values(walletWrites.slice(i, i + WALLET_CHUNK))
          .onConflictDoNothing({ target: wallets.address });
      }

      // 4. Fetch DB Wallet IDs for mapping
      const dbWallets = await db.select({ id: wallets.id, address: wallets.address })
        .from(wallets)
        .all(); // Since we are isolated in a script, it's ok to fetch all. For scale, we'd chunk ‘inArray’

      const walletMap = new Map();
      for(const w of dbWallets) {
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
      const TRADES_CHUNK = 500;
      for (let i = 0; i < mappedTradePayloads.length; i += TRADES_CHUNK) {
        const chunk = mappedTradePayloads.slice(i, i + TRADES_CHUNK);
        await db.insert(trades).values(chunk).onConflictDoNothing({ target: trades.transactionHash });
      }

      totalIngested += mappedTradePayloads.length;
      console.log(`[Subgraph] Inserted ${mappedTradePayloads.length} delta trades...`);
    }

    // Update cursor for the next infinite backward loop
    const oldestTrade = tradesList[tradesList.length - 1];
    beforeTimestamp = oldestTrade.timestamp;
  }

  console.log(`[Subgraph] 🎉 Successfully ingested ${totalIngested} total historical trades backfilled from Goldsky.`);
}

// -----------------------------------------------------
// Phase 23: Auto-Targeting Backfill Functions
// -----------------------------------------------------
export async function autoBackfillTopMarkets(limit: number) {
  console.log(`[Subgraph] Auto-Targeting Top ${limit} Markets by Volume...`);
  const topMarkets = await db.select().from(markets).orderBy(desc(markets.volume)).limit(limit).all();

  for (const market of topMarkets) {
    console.log(`\n=> Preparing to backfill: ${market.question} (Vol: $${market.volume?.toLocaleString()})`);
    await backfillMarket(market.conditionId);
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

  for (const market of matchedMarkets) {
    console.log(`\n=> Preparing to backfill: ${market.question} (Vol: $${market.volume?.toLocaleString()})`);
    await backfillMarket(market.conditionId);
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
}
