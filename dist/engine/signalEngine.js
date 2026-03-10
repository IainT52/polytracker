"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTradeForAlphaSignal = processTradeForAlphaSignal;
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const telegramBot_1 = require("../bot/telegramBot");
const tradeExecutor_1 = require("../services/tradeExecutor");
async function processTradeForAlphaSignal(tradeId, walletId, marketId, outcomeIndex, price, timestamp) {
    // 1. Check if signal already fired permanently for this market
    const marketRecord = await db_1.db.select({ alphaSignalFired: schema_1.markets.alphaSignalFired }).from(schema_1.markets).where((0, drizzle_orm_1.eq)(schema_1.markets.id, marketId)).limit(1);
    if (!marketRecord.length || marketRecord[0].alphaSignalFired) {
        return; // Already triggered the alpha broadcast
    }
    // 2. Fetch wallet grade
    const wallet = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.id, walletId)).get();
    if (!wallet || !wallet.grade || (wallet.grade !== 'A' && wallet.grade !== 'B')) {
        return; // Only care about Smart Money
    }
    // 2. Fetch all Grade A/B wallets
    const smartMoneyWallets = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.inArray)(schema_1.wallets.grade, ['A', 'B'])).all();
    const smartMoneyIds = smartMoneyWallets.map(w => w.id);
    const smartMoneyMap = new Map(smartMoneyWallets.map(w => [w.id, w]));
    if (smartMoneyIds.length === 0)
        return;
    // 3. Native Lifetime Accumulation DB Query targeting this specific market
    // Computes absolute net shares mapping (BUYS minus SELLS)
    const lifetimePositions = await db_1.db.select({
        walletId: schema_1.trades.walletId,
        outcomeIndex: schema_1.trades.outcomeIndex,
        netShares: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.trades.action} = 'BUY' THEN ${schema_1.trades.shares} ELSE -${schema_1.trades.shares} END)`.mapWith(Number)
    })
        .from(schema_1.trades)
        .where((0, drizzle_orm_1.eq)(schema_1.trades.marketId, marketId))
        .groupBy(schema_1.trades.walletId, schema_1.trades.outcomeIndex)
        .all();
    // 4. Filter for currently positive (net long) A/B holders
    // 4. Filter for currently positive (net long) A/B holders, aggressively filtering floating-point dust
    const positiveHolders = lifetimePositions.filter(p => p.netShares > 1 && smartMoneyIds.includes(p.walletId));
    // 5. Dynamically Group by Outcome Index
    const holdersByOutcome = {};
    for (const p of positiveHolders) {
        if (!holdersByOutcome[p.outcomeIndex])
            holdersByOutcome[p.outcomeIndex] = [];
        holdersByOutcome[p.outcomeIndex].push(p);
    }
    const groupedOutcomes = Object.entries(holdersByOutcome).map(([oIdxStr, holders]) => ({
        outcomeIndex: Number(oIdxStr),
        holdersCount: holders.length,
        holders
    }));
    // Sort descending by holder conviction
    groupedOutcomes.sort((a, b) => b.holdersCount - a.holdersCount);
    if (groupedOutcomes.length === 0)
        return;
    const favoredGroup = groupedOutcomes[0];
    const secondFavoredGroup = groupedOutcomes.length > 1 ? groupedOutcomes[1] : { holdersCount: 0 };
    // 6. Evaluate Lifetime Net Conviction against the closest competitor
    const netConviction = favoredGroup.holdersCount - secondFavoredGroup.holdersCount;
    // 7. Signal checks threshold against DB Lock
    if (netConviction >= 2) {
        // Lock the signal permanently in the DB to prevent duplicate firings
        await db_1.db.update(schema_1.markets).set({ alphaSignalFired: true }).where((0, drizzle_orm_1.eq)(schema_1.markets.id, marketId));
        const involvedEntries = favoredGroup.holders.map(h => {
            const w = smartMoneyMap.get(h.walletId);
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
function triggerAlphaSignal(marketId, outcomeIndex, walletsInvolved, triggerPrice, netConviction) {
    // Mock name lookup, normally resolved from the DB
    const marketName = `Polymarket Condition: ${marketId}`;
    const actionPhrase = `BUY Outcome ${outcomeIndex}`;
    // Forward to secure Telegram Broadcast Service
    (0, telegramBot_1.broadcastAlphaSignal)(marketName, actionPhrase, triggerPrice, walletsInvolved.map(w => ({
        address: w.walletAddress,
        grade: w.grade,
        recentRoi30d: w.recentRoi30d
    })), netConviction);
    // Phase 6, 11 & 12: Trigger Automated Web Dashboard Trading with Net Conviction Context
    (0, tradeExecutor_1.executeAutoTrades)(marketId, outcomeIndex, triggerPrice, netConviction, walletsInvolved.map(w => w.walletAddress)).catch(e => {
        console.error('[SignalEngine] Error triggering auto trades:', e);
    });
}
