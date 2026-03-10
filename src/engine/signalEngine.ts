import { db } from '../db';
import { wallets, trades } from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { broadcastAlphaSignal } from '../bot/telegramBot';
import { executeAutoTrades } from '../services/tradeExecutor';

// Global Safety Set to prevent duplicate execution of identical market-outcome alpha signals
const signaledMarkets = new Set<string>();

export async function processTradeForAlphaSignal(tradeId: number, walletId: number, marketId: number, outcomeIndex: number, price: number, timestamp: Date) {
  // 1. Fetch wallet grade
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
  const positiveHolders = lifetimePositions.filter(p => p.netShares > 0 && smartMoneyIds.includes(p.walletId));

  const outcome0Holders = positiveHolders.filter(p => p.outcomeIndex === 0);
  const outcome1Holders = positiveHolders.filter(p => p.outcomeIndex === 1);

  const distinctWalletsThisOutcome = outcomeIndex === 0 ? outcome0Holders : outcome1Holders;
  const distinctWalletsOppositeOutcome = outcomeIndex === 0 ? outcome1Holders : outcome0Holders;

  // 5. Evaluate Lifetime Net Conviction
  const netConviction = Math.abs(outcome0Holders.length - outcome1Holders.length);

  // 6. Signal checks threshold and verifies Safety Set lock
  const signalKey = `${marketId}-${outcomeIndex}`;

  if (netConviction >= 2 && !signaledMarkets.has(signalKey)) {
    // Lock the signal to prevent duplicate firing continuously
    signaledMarkets.add(signalKey);

    const involvedEntries = distinctWalletsThisOutcome.map(h => {
      const w = smartMoneyMap.get(h.walletId)!;
      return {
        walletAddress: w.address,
        grade: w.grade || 'N/A', // TypeScript Safe
        recentRoi30d: w.recentRoi30d ?? 0
      };
    });

    triggerAlphaSignal(marketId, outcomeIndex, involvedEntries, price, netConviction);
  }
}

// Refactored to trigger the Telegram bot 
function triggerAlphaSignal(marketId: number, outcomeIndex: number, walletsInvolved: { walletAddress: string, grade: string, recentRoi30d: number }[], triggerPrice: number, netConviction: number) {
  const isYes = outcomeIndex === 0;

  // Mock name lookup, normally resolved from the DB
  const marketName = `Polymarket Condition: ${marketId}`;
  const actionPhrase = `BUY ${isYes ? 'YES' : 'NO'}`;

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
