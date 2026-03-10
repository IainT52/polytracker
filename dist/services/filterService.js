"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTradeForFilter = processTradeForFilter;
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
// Filter Configuration based on User constraints
const MIN_SHARES = 10;
const MIN_VALUE_USD = 10.0;
const MAX_TRADES_PER_HOUR = 100;
const MAX_TRADES_PER_DAY = 1000;
// In-memory frequency counters (for simplicity in this phase)
// In production, redis or DB aggregates would be used.
const hourlyTradeCount = new Map();
const dailyTradeCount = new Map();
async function processTradeForFilter(tradeData, isHistorical = false) {
    const address = tradeData.taker?.toLowerCase();
    if (!address)
        return false;
    const shares = parseFloat(tradeData.size || '0');
    const price = parseFloat(tradeData.price || '0');
    const value = shares * price;
    // 1. Filter Micro-transactions
    if (shares < MIN_SHARES || value < MIN_VALUE_USD) {
        return false; // Discard trade
    }
    // 2. Filter High-Frequency Bots
    // Skip this memory-intensive check during bulk historical ingestion, 
    // because Date.now() is incorrect for trades that happened weeks ago
    if (!isHistorical) {
        const isBot = await checkAndFlagBot(address);
        if (isBot) {
            return false; // Discard trades from known bots
        }
    }
    return true; // Trade is valid
}
async function checkAndFlagBot(address) {
    const now = Date.now();
    // Initialize or Reset Hourly Counter
    if (!hourlyTradeCount.has(address) || (now - hourlyTradeCount.get(address).start > 3600000)) {
        // Prevent OOM memory leak by capping map size
        if (hourlyTradeCount.size > 50000)
            hourlyTradeCount.clear();
        hourlyTradeCount.set(address, { count: 0, start: now });
    }
    // Initialize or Reset Daily Counter
    if (!dailyTradeCount.has(address) || (now - dailyTradeCount.get(address).start > 86400000)) {
        if (dailyTradeCount.size > 50000)
            dailyTradeCount.clear();
        dailyTradeCount.set(address, { count: 0, start: now });
    }
    // Increment Counters
    const hourly = hourlyTradeCount.get(address);
    const daily = dailyTradeCount.get(address);
    hourly.count++;
    daily.count++;
    // Check Thresholds
    if (hourly.count > MAX_TRADES_PER_HOUR || daily.count > MAX_TRADES_PER_DAY) {
        // Flag as bot in DB
        await db_1.db.update(schema_1.wallets)
            .set({ isBot: true })
            .where((0, drizzle_orm_1.eq)(schema_1.wallets.address, address));
        console.warn(`[Filter] Flagged ${address} as High-Frequency Bot. (Hourly: ${hourly.count}, Daily: ${daily.count})`);
        return true; // Is a bot
    }
    // Check if previously flagged in DB
    const wallet = await db_1.db.select({ isBot: schema_1.wallets.isBot }).from(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.address, address)).get();
    if (wallet?.isBot) {
        return true; // Already flagged
    }
    return false;
}
