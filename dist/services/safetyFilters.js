"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTradeSafety = validateTradeSafety;
/**
 * Executes strict automated safety checks against a Level 2 order book
 * @param orderBook The current L2 Order Book from Polymarket CLOB
 * @param alphaSignalPrice The price the Alpha Signal was triggered at
 * @param fixedBetSizeUsd The amount of USDC the user wants to deploy
 * @param maxSpreadBps The maximum allowable spread (e.g. 200 = 2%)
 * @param maxSlippageCents The maximum price deviation allowed (e.g. 2 = $0.02)
 * @param minOrderbookLiquidityUsd Make sure there's enough depth before slippage threshold
 */
function validateTradeSafety(orderBook, alphaSignalPrice, fixedBetSizeUsd, maxSpreadBps, maxSlippageCents, minOrderbookLiquidityUsd) {
    if (!orderBook.asks.length || !orderBook.bids.length) {
        return { passed: false, reason: 'Empty order book' };
    }
    // 1. Calculate Spread
    const bestAsk = orderBook.asks[0].price;
    const bestBid = orderBook.bids[0].price;
    const spread = (bestAsk - bestBid) / bestAsk;
    if (spread * 10000 > maxSpreadBps) {
        return {
            passed: false,
            reason: `Spread too high: ${(spread * 100).toFixed(2)}% > ${(maxSpreadBps / 100).toFixed(2)}%`
        };
    }
    // 2. Simulate Fill
    let remainingUsdc = fixedBetSizeUsd;
    let totalShares = 0;
    let totalCost = 0;
    let availableLiquidityUsd = 0;
    const maxAllowedPrice = alphaSignalPrice + (maxSlippageCents / 100);
    for (const ask of orderBook.asks) {
        // Only count liquidity up to the user's slippage limit
        if (ask.price <= maxAllowedPrice) {
            const askVolumeUsd = ask.price * ask.size;
            availableLiquidityUsd += askVolumeUsd;
            if (remainingUsdc > 0) {
                // We still need to fill our order
                const costFromThisTick = Math.min(remainingUsdc, askVolumeUsd);
                const sharesFromThisTick = costFromThisTick / ask.price;
                totalShares += sharesFromThisTick;
                totalCost += costFromThisTick;
                remainingUsdc -= costFromThisTick;
            }
        }
    }
    // 3. Liquidity Check
    if (availableLiquidityUsd < minOrderbookLiquidityUsd) {
        return {
            passed: false,
            reason: `Insufficient liquidity: $${availableLiquidityUsd.toFixed(2)} available under slippage limit, require $${minOrderbookLiquidityUsd}`
        };
    }
    // 4. Slippage / Fill Check
    if (remainingUsdc > 0) {
        return { passed: false, reason: 'Order too large for available liquidity under slippage limit' };
    }
    const avgExecutionPrice = totalCost / totalShares;
    if (avgExecutionPrice > maxAllowedPrice) {
        return {
            passed: false,
            reason: `Slippage exceeded: Avg execution $${avgExecutionPrice.toFixed(4)} > Max allowed $${maxAllowedPrice.toFixed(4)}`
        };
    }
    return {
        passed: true,
        executionPrice: avgExecutionPrice,
        expectedShares: totalShares
    };
}
