import { db } from '../db';
import { wallets, trades, markets } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { broadcastAlphaSignal } from '../bot/telegramBot';
import { executeAutoTrades } from '../services/tradeExecutor';

export async function processTradeForAlphaSignal(tradeId: number, walletId: number, marketId: number, outcomeIndex: number, price: number, timestamp: Date) {
  // 1. Check if signal already fired permanently for this market
  const marketRecord = await db.select({ alphaSignalFired: markets.alphaSignalFired }).from(markets).where(eq(markets.id, marketId)).limit(1);
  if (!marketRecord.length || marketRecord[0].alphaSignalFired) {
    return; // Already triggered the alpha broadcast
  }

  // 2. Fetch wallet grade
  const wallet = await db.select().from(wallets).where(eq(wallets.id, walletId)).get();

  if (!wallet || !wallet.grade || (wallet.grade !== 'A' && wallet.grade !== 'B')) {
    return; // Only care about Smart Money
  }

  // 2. Fetch all Grade A/B wallets
  const smartMoneyWallets = await db.select().from(wallets).where(inArray(wallets.grade, ['A', 'B'])).all();
  const smartMoneyIds = smartMoneyWallets.map(w => w.id);
  const smartMoneyMap = new Map(smartMoneyWallets.map(w => [w.id, w]));

  if (smartMoneyIds.length === 0) return;

  // 3. Native Lifetime Accumulation DB Query targeting this specific market
  // Computes absolute net shares mapping (BUYS minus SELLS)
  const lifetimePositions = await db.select({
    walletId: trades.walletId,
    outcomeIndex: trades.outcomeIndex,
    netShares: sql<number>`SUM(CASE WHEN ${trades.action} = 'BUY' THEN ${trades.shares} ELSE -${trades.shares} END)`.mapWith(Number)
  })
    .from(trades)
    .where(eq(trades.marketId, marketId))
    .groupBy(trades.walletId, trades.outcomeIndex)
    .all();

  // 4. Filter for currently positive (net long) A/B holders
  // 4. Filter for currently positive (net long) A/B holders, aggressively filtering floating-point dust
  const positiveHolders = lifetimePositions.filter(p => p.netShares > 1 && smartMoneyIds.includes(p.walletId));

  // 5. Dynamically Group by Outcome Index
  const holdersByOutcome: Record<number, typeof positiveHolders> = {};
  for (const p of positiveHolders) {
    if (!holdersByOutcome[p.outcomeIndex]) holdersByOutcome[p.outcomeIndex] = [];
    holdersByOutcome[p.outcomeIndex].push(p);
  }

  const groupedOutcomes = Object.entries(holdersByOutcome).map(([oIdxStr, holders]) => ({
    outcomeIndex: Number(oIdxStr),
    holdersCount: holders.length,
    holders
  }));

  // Sort descending by holder conviction
  groupedOutcomes.sort((a, b) => b.holdersCount - a.holdersCount);

  if (groupedOutcomes.length === 0) return;

  const favoredGroup = groupedOutcomes[0];
  const secondFavoredGroup = groupedOutcomes.length > 1 ? groupedOutcomes[1] : { holdersCount: 0 };

  // 6. Evaluate Lifetime Net Conviction against the closest competitor
  const netConviction = favoredGroup.holdersCount - secondFavoredGroup.holdersCount;

  // 7. Signal checks threshold against DB Lock
  if (netConviction >= 2) {
    // Lock the signal permanently in the DB to prevent duplicate firings
    await db.update(markets).set({ alphaSignalFired: true }).where(eq(markets.id, marketId));

    const involvedEntries = favoredGroup.holders.map(h => {
      const w = smartMoneyMap.get(h.walletId)!;
      return {
        walletAddress: w.address,
        grade: w.grade || 'N/A',
        recentRoi30d: w.recentRoi30d ?? 0
      };
    });

    triggerAlphaSignal(marketId, favoredGroup.outcomeIndex, involvedEntries, price, netConviction);
  }
}

// Refactored to trigger the Telegram bot 
function triggerAlphaSignal(marketId: number, outcomeIndex: number, walletsInvolved: { walletAddress: string, grade: string, recentRoi30d: number }[], triggerPrice: number, netConviction: number) {
  // Mock name lookup, normally resolved from the DB
  const marketName = `Polymarket Condition: ${marketId}`;
  const actionPhrase = `BUY Outcome ${outcomeIndex}`;

  // Forward to secure Telegram Broadcast Service
  broadcastAlphaSignal(marketName, actionPhrase, triggerPrice, walletsInvolved.map(w => ({
    address: w.walletAddress,
    grade: w.grade,
    recentRoi30d: w.recentRoi30d
  })), netConviction);

  // Phase 6, 11 & 12: Trigger Automated Web Dashboard Trading with Net Conviction Context
  executeAutoTrades(marketId, outcomeIndex, triggerPrice, netConviction, walletsInvolved.map(w => w.walletAddress)).catch(e => {
    console.error('[SignalEngine] Error triggering auto trades:', e);
  });
}
