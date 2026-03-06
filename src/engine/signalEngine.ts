import { db } from '../db';
import { wallets } from '../db/schema';
import { eq } from 'drizzle-orm';

interface SignalCacheEntry {
  walletId: number;
  walletAddress: string;
  grade: string;
  price: number;
  recentRoi30d: number;
  timestamp: Date;
}

// Memory structure: marketId -> outcomeIndex -> Array of Trade Entries
const recentAlertMemory = new Map<number, Map<number, SignalCacheEntry[]>>();

const WINDOW_15_MINUTES = 15 * 60 * 1000;
const MAX_PRICE_DIFF = 0.10; // $0.10

export async function processTradeForAlphaSignal(tradeId: number, walletId: number, marketId: number, outcomeIndex: number, price: number, timestamp: Date) {
  // 1. Fetch wallet grade
  const wallet = await db.select().from(wallets).where(eq(wallets.id, walletId)).get();

  if (!wallet || !wallet.grade || (wallet.grade !== 'A' && wallet.grade !== 'B')) {
    return; // Only care about Smart Money
  }

  // 2. Initialize memory structures
  if (!recentAlertMemory.has(marketId)) {
    recentAlertMemory.set(marketId, new Map());
  }
  const marketMemory = recentAlertMemory.get(marketId)!;
  if (!marketMemory.has(outcomeIndex)) {
    marketMemory.set(outcomeIndex, []);
  }
  const outcomeMemory = marketMemory.get(outcomeIndex)!;

  // 3. Clean up expired entries (> 15 mins old)
  const now = new Date().getTime();
  for (let i = outcomeMemory.length - 1; i >= 0; i--) {
    if (now - outcomeMemory[i].timestamp.getTime() > WINDOW_15_MINUTES) {
      outcomeMemory.splice(i, 1);
    }
  }

  // 4. Clean up opposite outcome memory as well
  const oppositeOutcomeIndex = outcomeIndex === 0 ? 1 : 0;
  if (!marketMemory.has(oppositeOutcomeIndex)) {
    marketMemory.set(oppositeOutcomeIndex, []);
  }
  const oppositeMemory = marketMemory.get(oppositeOutcomeIndex)!;
  for (let i = oppositeMemory.length - 1; i >= 0; i--) {
    if (now - oppositeMemory[i].timestamp.getTime() > WINDOW_15_MINUTES) {
      oppositeMemory.splice(i, 1);
    }
  }

  // 5. Add new trade to memory
  outcomeMemory.push({
    walletId,
    walletAddress: wallet.address,
    grade: wallet.grade,
    price,
    recentRoi30d: wallet.recentRoi30d ?? 0,
    timestamp
  });

  // 6. Evaluate Net Conviction Alpha Signal Rules
  const distinctWalletsThisOutcome = new Map();
  for (const entry of outcomeMemory) {
    distinctWalletsThisOutcome.set(entry.walletAddress, entry);
  }

  const distinctWalletsOppositeOutcome = new Set();
  for (const entry of oppositeMemory) {
    distinctWalletsOppositeOutcome.add(entry.walletAddress);
  }

  const netConviction = distinctWalletsThisOutcome.size - distinctWalletsOppositeOutcome.size;

  // Signal triggers if Net Conviction >= 2 (Global Baseline)
  if (netConviction >= 2) {
    // Check if price difference is tight enough
    const entries = Array.from(distinctWalletsThisOutcome.values());
    const minPrice = Math.min(...entries.map(e => e.price));
    const maxPrice = Math.max(...entries.map(e => e.price));

    if (maxPrice - minPrice <= MAX_PRICE_DIFF) {
      triggerAlphaSignal(marketId, outcomeIndex, entries, (minPrice + maxPrice) / 2, netConviction);

      // Clear memory to prevent duplicate firing
      outcomeMemory.length = 0;
      oppositeMemory.length = 0;
    }
  }
}

import { broadcastAlphaSignal } from '../bot/telegramBot';
import { executeAutoTrades } from '../services/tradeExecutor';

// Refactored to trigger the Telegram bot 
function triggerAlphaSignal(marketId: number, outcomeIndex: number, walletsInvolved: SignalCacheEntry[], avgPrice: number, netConviction: number) {
  const isYes = outcomeIndex === 0;

  // Mock name lookup, normally resolved from the DB
  const marketName = `Polymarket Condition: ${marketId}`;
  const actionPhrase = `BUY ${isYes ? 'YES' : 'NO'}`;

  // Forward to secure Telegram Broadcast Service
  broadcastAlphaSignal(marketName, actionPhrase, avgPrice, walletsInvolved.map(w => ({
    address: w.walletAddress,
    grade: w.grade,
    recentRoi30d: w.recentRoi30d
  })), netConviction);

  // Phase 6, 11 & 12: Trigger Automated Web Dashboard Trading with Net Conviction Context
  executeAutoTrades(marketId, outcomeIndex, avgPrice, netConviction, walletsInvolved.map(w => w.walletAddress)).catch(e => {
    console.error('[SignalEngine] Error triggering auto trades:', e);
  });
}

// --- Phase 13: Global Garbage Collection for Alpha Engine Memory ---
// Prevents Core V8 OOM crashes by actively seeking out and deleting dormant market memory keys
setInterval(() => {
  const now = Date.now();
  for (const [marketId, marketMemory] of recentAlertMemory.entries()) {
    let activeEntriesCount = 0;

    for (const [outcomeIndex, outcomeMemory] of marketMemory.entries()) {
      for (let i = outcomeMemory.length - 1; i >= 0; i--) {
        if (now - outcomeMemory[i].timestamp.getTime() > WINDOW_15_MINUTES) {
          outcomeMemory.splice(i, 1);
        }
      }
      activeEntriesCount += outcomeMemory.length;
      if (outcomeMemory.length === 0) {
        marketMemory.delete(outcomeIndex);
      }
    }

    // If the entire market dictionary is dormant, obliterate it from RAM entirely
    if (activeEntriesCount === 0) {
      recentAlertMemory.delete(marketId);
    }
  }
}, 5 * 60 * 1000); // Purge every 5 minutes
