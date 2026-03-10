import { db } from './src/db/index';
import { trades, wallets, markets } from './src/db/schema';
import { eq, sql, inArray, and } from 'drizzle-orm';

async function test() {
    const activeMarkets = await db.select({ id: markets.id, conditionId: markets.conditionId }).from(markets).where(eq(markets.resolved, false)).all();
    const activeMarketIds = activeMarkets.map(m => m.id);
    
    const smartMoneyWallets = await db.select({ id: wallets.id }).from(wallets).where(inArray(wallets.grade, ['A', 'B'])).all();
    const smartMoneyIds = smartMoneyWallets.map(w => w.id);

    const lifetimePositions = await db.select({
      marketId: trades.marketId,
      walletId: trades.walletId,
      outcomeIndex: trades.outcomeIndex,
      netShares: sql<number>`SUM(CASE WHEN ${trades.action} = 'BUY' THEN ${trades.shares} ELSE -${trades.shares} END)`.mapWith(Number)
    })
      .from(trades)
      .where(and(
        inArray(trades.marketId, activeMarketIds),
        inArray(trades.walletId, smartMoneyIds)
      ))
      .groupBy(trades.marketId, trades.walletId, trades.outcomeIndex)
      .all();

    for (const mId of activeMarketIds.slice(0, 10)) {
      const positiveHolders = lifetimePositions.filter(p => !!p && p.marketId === mId && p.netShares > 1);
      if (positiveHolders.length === 0) continue;

      const holdersByOutcome = {};
      for (const p of positiveHolders) {
        if (!holdersByOutcome[p.outcomeIndex]) holdersByOutcome[p.outcomeIndex] = [];
        holdersByOutcome[p.outcomeIndex].push(p);
      }
      
      const groupedOutcomes = Object.entries(holdersByOutcome).map(([oIdxStr, holders]) => ({
        outcomeIndex: Number(oIdxStr),
        holdersCount: holders.length,
        avgShares: holders.reduce((sum, h) => sum + h.netShares, 0) / holders.length
      }));

      console.log(`\nMarket ${mId}:`);
      console.log(groupedOutcomes);
    }
}
test().catch(console.error);
