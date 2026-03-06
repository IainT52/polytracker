import { fetchActiveMarkets, fetchMarketTrades } from './api';
import { db } from '../db';
import { markets, trades, wallets } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { processTradeForFilter } from './filterService';
import pLimit from 'p-limit';

export async function scrapeHistoricalData() {
  console.log('[Scraper] Starting Phase 10 Deep Historical Scrape with Controlled Concurrency...');

  // 1. Fetch Top 100 active markets globally sorted by Volume
  const activeMarkets = await fetchActiveMarkets(100);
  console.log(`[Scraper] Found ${activeMarkets.length} high-liquidity markets to process.`);

  let totalTradesIngested = 0;

  // 2. Concurrency Limiter: Analyze 5 markets simultaneously
  const marketConcurrencyLimit = pLimit(5);

  const scrapeMarket = async (marketData: any) => {
    try {
      // 2. Insert or update market
      let market = await db.select().from(markets).where(eq(markets.conditionId, marketData.conditionId)).get();

      if (!market) {
        [market] = await db.insert(markets).values({
          conditionId: marketData.conditionId,
          question: marketData.question,
          description: marketData.description,
          outcomes: JSON.stringify(marketData.outcomes),
          resolved: marketData.closed || !marketData.active,
        }).returning();
      } else {
        await db.update(markets)
          .set({ resolved: marketData.closed || !marketData.active })
          .where(eq(markets.conditionId, marketData.conditionId));
      }

      // 3. Fetch Deep Paginated trades for market (Up to 20,000)
      console.log(`[Scraper][Worker] Fetching deep pagination for market ${marketData.conditionId.substring(0, 8)}...`);
      const tradesList = await fetchMarketTrades(marketData.conditionId, 20000);
      console.log(`[Scraper][Worker] Fetched ${tradesList.length} historical trades for ${marketData.conditionId.substring(0, 8)}. Filtering...`);

      // 4. Batch Processing to avoid N+1 SQLite connection freezes
      const validTradesToInsert: any[] = [];
      const uniqueWalletsFound = new Set<string>();

      for (const tradeData of tradesList) {
        const isValid = await processTradeForFilter(tradeData, true);
        if (isValid) {
          uniqueWalletsFound.add(tradeData.taker);
          validTradesToInsert.push({
            marketId: market.id,
            outcomeIndex: 0, // Simplified: data-api gives us specific asset, we need mapping logic later
            action: tradeData.side,
            price: parseFloat(tradeData.price),
            shares: parseFloat(tradeData.size), // Data API uses 'size'
            timestamp: new Date(parseInt(tradeData.timestamp) * 1000),
            transactionHash: tradeData.transactionHash,
            _tempWalletAddr: tradeData.taker
          });
        }
      }

      if (validTradesToInsert.length === 0) return;

      // 5. Bulk ensure wallets exist
      for (const address of uniqueWalletsFound) {
        await db.insert(wallets).values({ address }).onConflictDoNothing({ target: wallets.address });
      }

      // Fetch all needed wallet IDs in a dictionary map cache (ONLY for the ones we discovered)
      const uniqueWalletAddresses = Array.from(uniqueWalletsFound);
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

      // 6. DB Bulk Insert inside Transaction boundary
      const CHUNK_SIZE = 500;
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

        await db.transaction(async (tx) => {
          for (const t of chunk) {
            await tx.insert(trades).values(t).onConflictDoNothing({ target: trades.transactionHash });
          }
        });
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
