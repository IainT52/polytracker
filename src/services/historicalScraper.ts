import { fetchActiveMarkets, fetchMarketTrades } from './api';
import { db } from '../db';
import { markets, trades, wallets } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { processTradeForFilter } from './filterService';
import { subscribeToMarket } from './realtimeListener';
import pLimit from 'p-limit';

export let isShuttingDown = false;
export function signalScraperShutdown() {
  console.log('[Scraper] Shutdown signal received. Halting new ingestion intervals...');
  isShuttingDown = true;
}

export async function scrapeHistoricalData() {
  console.log('[Scraper] Starting Phase 10 Deep Historical Scrape with Controlled Concurrency...');

  // 1. Fetch Top 100 active markets globally sorted by Volume
  const activeMarkets = await fetchActiveMarkets(100);
  console.log(`[Scraper] Found ${activeMarkets.length} high-liquidity markets to process.`);

  let totalTradesIngested = 0;

  // 2. Concurrency Limiter: Analyze 5 markets simultaneously
  const marketConcurrencyLimit = pLimit(5);

  const scrapeMarket = async (marketData: any) => {
    if (isShuttingDown) return;
    try {
      // 2. Insert or update market
      let market = await db.select().from(markets).where(eq(markets.conditionId, marketData.conditionId)).get();

      if (!market) {
        [market] = await db.insert(markets).values({
          conditionId: marketData.conditionId,
          question: marketData.question,
          description: marketData.description,
          outcomes: JSON.stringify(marketData.outcomes),
          clobTokenIds: JSON.stringify(marketData.clobTokenIds || []),
          resolved: marketData.closed || !marketData.active,
        }).returning();
      } else {
        await db.update(markets)
          .set({ resolved: marketData.closed || !marketData.active })
          .where(eq(markets.conditionId, marketData.conditionId));
      }

      // Phase 15: Automatically subscribe to this live market on the WebSocket
      subscribeToMarket(marketData.conditionId);

      // 3. Fetch Deep Paginated trades for market (Up to 20,000)
      console.log(`[Scraper][Worker] Fetching deep pagination for market ${marketData.conditionId.substring(0, 8)}...`);
      const tradesList = await fetchMarketTrades(marketData.conditionId, 20000);
      console.log(`[Scraper][Worker] Fetched ${tradesList.length} historical trades for ${marketData.conditionId.substring(0, 8)}. Filtering...`);

      // 4. Batch Processing to avoid N+1 SQLite connection freezes
      const validTradesToInsert: any[] = [];
      const uniqueWalletsFound = new Set<string>();
      const tokenIds = JSON.parse(market.clobTokenIds || '[]');

      // Phase 15: Process Filters using Promise.allSettled for isolated resilience
      const PROCESS_CHUNK_SIZE = 500;
      for (let i = 0; i < tradesList.length; i += PROCESS_CHUNK_SIZE) {
        if (isShuttingDown) {
          console.log('[Scraper][Worker] Aborting valid ingestion loop due to shutdown.');
          break;
        }

        const chunk = tradesList.slice(i, i + PROCESS_CHUNK_SIZE);

        const results = await Promise.allSettled(chunk.map(async (tradeData: any) => {
          const isValid = await processTradeForFilter(tradeData, true);
          if (isValid) {
            return {
              marketId: market.id,
              outcomeIndex: tokenIds.indexOf(tradeData.asset_id) !== -1 ? tokenIds.indexOf(tradeData.asset_id) : (tradeData.outcome || 0),
              action: tradeData.side,
              price: parseFloat(tradeData.price),
              shares: parseFloat(tradeData.size),
              timestamp: new Date(parseInt(tradeData.timestamp) * 1000),
              transactionHash: tradeData.transactionHash,
              _tempWalletAddr: tradeData.taker
            };
          }
          return null;
        }));

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            uniqueWalletsFound.add(result.value._tempWalletAddr);
            validTradesToInsert.push(result.value);
          } else if (result.status === 'rejected') {
            // Silently absorb specific provider timeouts without blowing up the batch
            console.warn(`[Scraper][Worker] Trade validation rejected:`, result.reason?.message || result.reason);
          }
        }
      }

      if (validTradesToInsert.length === 0) return;

      // 5. Bulk ensure wallets exist using chunked array inserts
      const uniqueWalletAddresses = Array.from(uniqueWalletsFound);
      const WALLET_CHUNK_SIZE = 500; // max variables 999
      for (let i = 0; i < uniqueWalletAddresses.length; i += WALLET_CHUNK_SIZE) {
        const chunk = uniqueWalletAddresses.slice(i, i + WALLET_CHUNK_SIZE).map(address => ({ address }));
        if (chunk.length > 0) {
          // Wrapped in pseudo-retry for locked DBs on parallel workers
          let retries = 3;
          while (retries > 0) {
            try {
              await db.insert(wallets).values(chunk).onConflictDoNothing({ target: wallets.address });
              break;
            } catch (err: any) {
              retries--;
              if (retries === 0) throw err;
              await new Promise(res => setTimeout(res, 250 + Math.random() * 500));
            }
          }
        }
      }

      // Fetch all needed wallet IDs in a dictionary map cache (ONLY for the ones we discovered)
      const dbWallets: any[] = [];
      const MAX_SQLITE_VARIABLES = 900; // Safe limit below 999

      for (let i = 0; i < uniqueWalletAddresses.length; i += MAX_SQLITE_VARIABLES) {
        const chunk = uniqueWalletAddresses.slice(i, i + MAX_SQLITE_VARIABLES);
        if (chunk.length > 0) {
          const found = await db.select({ id: wallets.id, address: wallets.address })
            .from(wallets)
            .where(inArray(wallets.address, chunk))
            .all();
          dbWallets.push(...found);
        }
      }

      const walletMap = new Map(dbWallets.map(w => [w.address, w.id]));

      // 6. DB Bulk Insert using Array Inserts inside Transactions
      const CHUNK_SIZE = 100; // 100 rows * 8 columns = 800 parameters (safe limit < 999)
      for (let i = 0; i < validTradesToInsert.length; i += CHUNK_SIZE) {
        const chunk = validTradesToInsert.slice(i, i + CHUNK_SIZE).map(t => {
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
        });

        if (chunk.length > 0) {
          let retries = 3;
          while (retries > 0) {
            try {
              await db.transaction(async (tx) => {
                await tx.insert(trades).values(chunk).onConflictDoNothing({ target: trades.transactionHash });
              });
              break;
            } catch (err: any) {
              retries--;
              if (retries === 0) throw err;
              await new Promise(res => setTimeout(res, 250 + Math.random() * 500));
            }
          }
        }
      }

      totalTradesIngested += validTradesToInsert.length;
      console.log(`[Scraper][Worker] ✅ Market ${marketData.conditionId.substring(0, 8)} Complete.`);
    } catch (e: any) {
      console.error(`[Scraper][Worker] ❌ Failed to process market ${marketData.conditionId}:`, e.message);
    }
  };

  // Run all 100 markets through the concurrency limiter
  const extractionPromises = activeMarkets.map(marketData => marketConcurrencyLimit(() => scrapeMarket(marketData)));
  await Promise.all(extractionPromises);

  console.log(`[Scraper] Deep History scrape complete! Added ${totalTradesIngested} clean trades to Dataset.`);
}
