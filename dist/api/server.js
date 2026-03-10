"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startApiServer = startApiServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const ethers_1 = require("ethers");
const encryption_1 = require("../bot/encryption");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Get dashboard config for a Telegram User ID
app.get('/api/config/:telegramId', async (req, res) => {
    const telegramId = req.params.telegramId;
    console.log(`[API] Endpoint /api/config reached for telegram ID: ${telegramId}`);
    try {
        console.log(`[API] Attempting db.select().from(users)...`);
        let user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.telegramId, telegramId)).get();
        console.log(`[API] db.select().from(users) completed.`);
        if (!user) {
            console.log(`[API] Auto-creating demo user for telegram ID: ${telegramId}`);
            const wallet = ethers_1.ethers.Wallet.createRandom();
            const insertResult = await db_1.db.insert(schema_1.users).values({
                telegramId,
                username: 'DemoUser',
                encryptedPrivateKey: (0, encryption_1.encryptKey)('0x0000000000000000000000000000000000000000000000000000000000000000') // Bypassing missing process.env.ENCRYPTION_KEY locally if needed
            }).onConflictDoUpdate({
                target: schema_1.users.telegramId,
                set: { telegramId } // Dummy update to return row
            }).returning();
            user = insertResult[0];
        }
        let config = await db_1.db.select().from(schema_1.autoTradeConfigs).where((0, drizzle_orm_1.eq)(schema_1.autoTradeConfigs.userId, user.id)).get();
        // Create default config if none exists
        if (!config) {
            [config] = await db_1.db.insert(schema_1.autoTradeConfigs).values({
                userId: user.id
            }).returning();
        }
        res.json(config);
    }
    catch (error) {
        console.error("FATAL CONFIG ERROR:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Update dashboard config
app.post('/api/config/:telegramId', async (req, res) => {
    const telegramId = req.params.telegramId;
    const updates = req.body;
    try {
        const user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.telegramId, telegramId)).get();
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        // Validate updates
        const sanitizedUpdates = {};
        if (updates.isAutoTradeEnabled !== undefined)
            sanitizedUpdates.isAutoTradeEnabled = Boolean(updates.isAutoTradeEnabled);
        if (updates.isPaperTradingMode !== undefined)
            sanitizedUpdates.isPaperTradingMode = Boolean(updates.isPaperTradingMode);
        if (updates.maxSpreadBps !== undefined)
            sanitizedUpdates.maxSpreadBps = Number(updates.maxSpreadBps);
        if (updates.maxSlippageCents !== undefined)
            sanitizedUpdates.maxSlippageCents = Number(updates.maxSlippageCents);
        if (updates.minOrderbookLiquidityUsd !== undefined)
            sanitizedUpdates.minOrderbookLiquidityUsd = String(updates.minOrderbookLiquidityUsd);
        if (updates.fixedBetSizeUsd !== undefined)
            sanitizedUpdates.fixedBetSizeUsd = String(updates.fixedBetSizeUsd);
        if (updates.takeProfitPct !== undefined)
            sanitizedUpdates.takeProfitPct = Number(updates.takeProfitPct);
        if (updates.stopLossPct !== undefined)
            sanitizedUpdates.stopLossPct = Number(updates.stopLossPct);
        // Phase 11: Dynamic Sizing Parameters
        if (updates.minWhalesToTrigger !== undefined)
            sanitizedUpdates.minWhalesToTrigger = Number(updates.minWhalesToTrigger);
        if (updates.dynamicSizingEnabled !== undefined)
            sanitizedUpdates.dynamicSizingEnabled = Boolean(updates.dynamicSizingEnabled);
        if (updates.convictionMultiplier !== undefined)
            sanitizedUpdates.convictionMultiplier = Number(updates.convictionMultiplier);
        const config = await db_1.db.update(schema_1.autoTradeConfigs)
            .set(sanitizedUpdates)
            .where((0, drizzle_orm_1.eq)(schema_1.autoTradeConfigs.userId, user.id))
            .returning()
            .get();
        res.json(config);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get recent trades (positions & paper positions)
app.get('/api/positions/:telegramId', async (req, res) => {
    const telegramId = req.params.telegramId;
    try {
        const user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.telegramId, telegramId)).get();
        if (!user)
            return res.json([]);
        const realPositions = await db_1.db.select({
            id: schema_1.userPositions.id,
            marketId: schema_1.userPositions.marketId,
            question: schema_1.markets.question,
            buyPrice: schema_1.userPositions.buyPrice,
            shares: schema_1.userPositions.shares,
            totalCost: schema_1.userPositions.totalCost,
            timestamp: schema_1.userPositions.timestamp,
            status: schema_1.userPositions.status,
            isPaper: (0, drizzle_orm_1.sql) `0`.as('isPaper')
        })
            .from(schema_1.userPositions)
            .leftJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.userPositions.marketId, schema_1.markets.id))
            .where((0, drizzle_orm_1.eq)(schema_1.userPositions.userId, user.id));
        const simPositions = await db_1.db.select({
            id: schema_1.paperPositions.id,
            marketId: schema_1.paperPositions.marketId,
            question: schema_1.markets.question,
            buyPrice: schema_1.paperPositions.buyPrice,
            shares: schema_1.paperPositions.shares,
            totalCost: schema_1.paperPositions.totalCost,
            timestamp: schema_1.paperPositions.timestamp,
            status: schema_1.paperPositions.status,
            isPaper: (0, drizzle_orm_1.sql) `1`.as('isPaper')
        })
            .from(schema_1.paperPositions)
            .leftJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.paperPositions.marketId, schema_1.markets.id))
            .where((0, drizzle_orm_1.eq)(schema_1.paperPositions.userId, user.id));
        // Combine and sort
        const allPositions = [...realPositions, ...simPositions].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 50);
        res.json(allPositions);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Phase 7: Historical Backtesting Endpoint
// Mocks a rapid replay of historical alpha signals against user safety parameters
app.post('/api/backtest/:telegramId', async (req, res) => {
    const telegramId = req.params.telegramId;
    const { startDate, endDate } = req.body;
    try {
        const user = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.telegramId, telegramId)).get();
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const config = await db_1.db.select().from(schema_1.autoTradeConfigs).where((0, drizzle_orm_1.eq)(schema_1.autoTradeConfigs.userId, user.id)).get();
        if (!config)
            return res.status(400).json({ error: 'Config missing' });
        // Phase 14: Authentic SQL Simulation
        // Find historical trades made by Grade A/B wallets in this timeframe
        const fromDate = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const toDate = endDate ? new Date(endDate) : new Date();
        const smartHistoricalTrades = await db_1.db.select({
            id: schema_1.trades.id,
            marketId: schema_1.trades.marketId,
            question: schema_1.markets.question,
            outcomeIndex: schema_1.trades.outcomeIndex,
            price: schema_1.trades.price,
            action: schema_1.trades.action,
            timestamp: schema_1.trades.timestamp,
            walletGrade: schema_1.wallets.grade
        })
            .from(schema_1.trades)
            .innerJoin(schema_1.wallets, (0, drizzle_orm_1.eq)(schema_1.trades.walletId, schema_1.wallets.id))
            .innerJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.trades.marketId, schema_1.markets.id))
            .where((0, drizzle_orm_1.sql) `${schema_1.wallets.grade} IN ('A', 'B') 
        AND ${schema_1.trades.timestamp} >= ${fromDate} 
        AND ${schema_1.trades.timestamp} <= ${toDate}`)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.trades.timestamp))
            .limit(100); // Sample limit
        // Transform into simulated position structure
        const fixedBetSize = parseFloat(config.fixedBetSizeUsd);
        // Simplistic V1 simulation: assumes filling at exact signal entry price
        const mappedResults = smartHistoricalTrades.map((t, index) => {
            const isWin = Math.random() > 0.4; // Temporarily randomize outcome until real market resolutions map
            return {
                id: index,
                question: `[V1 Sim] ${t.question}`,
                buyPrice: t.price,
                shares: fixedBetSize / t.price,
                totalCost: fixedBetSize,
                timestamp: t.timestamp,
                status: isWin ? 'PAPER_WON' : 'PAPER_LOST',
                realizedPnL: isWin ? fixedBetSize * ((1 - t.price) / t.price) : -fixedBetSize,
                resolvedPrice: isWin ? 1 : 0
            };
        });
        res.json(mappedResults);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get Top Rated Wallets with Dynamic Filters
app.get('/api/stats/wallets', async (req, res) => {
    try {
        const { grade, minTrades, minVolume, minWinRate, minRoi } = req.query;
        const conditions = [(0, drizzle_orm_1.eq)(schema_1.wallets.isBot, false)];
        if (grade && grade !== 'ALL') {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.wallets.grade, String(grade)));
        }
        if (minTrades && !isNaN(Number(minTrades))) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wallets.totalTrades, Number(minTrades)));
        }
        if (minVolume && !isNaN(Number(minVolume))) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wallets.totalVolume, Number(minVolume)));
        }
        if (minWinRate && !isNaN(Number(minWinRate))) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wallets.winRate, Number(minWinRate)));
        }
        if (minRoi && !isNaN(Number(minRoi))) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.wallets.roi, Number(minRoi)));
        }
        const topWallets = await db_1.db.select()
            .from(schema_1.wallets)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.wallets.roi))
            .limit(50);
        res.json(topWallets);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get aggregate signal stats (mocked for visualization)
app.get('/api/stats/signals', async (req, res) => {
    try {
        const totalSignalsRes = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` }).from(schema_1.paperPositions).get();
        const totalSignals = totalSignalsRes?.count || 0;
        const winsRes = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` })
            .from(schema_1.paperPositions)
            .where((0, drizzle_orm_1.inArray)(schema_1.paperPositions.status, ['PAPER_WON', 'SOLD_TP']))
            .get();
        const resolvedRes = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` })
            .from(schema_1.paperPositions)
            .where((0, drizzle_orm_1.inArray)(schema_1.paperPositions.status, ['PAPER_WON', 'PAPER_LOST', 'SOLD_TP', 'SOLD_SL']))
            .get();
        const wins = winsRes?.count || 0;
        const resolved = resolvedRes?.count || 0;
        const winRate = resolved > 0 ? (wins / resolved) * 100 : 0;
        // Avg ROI
        const pnlStats = await db_1.db.select({
            totalRealized: (0, drizzle_orm_1.sql) `SUM(CAST(${schema_1.paperPositions.realizedPnL} AS REAL))`,
            totalCost: (0, drizzle_orm_1.sql) `SUM(CAST(${schema_1.paperPositions.totalCost} AS REAL))`
        }).from(schema_1.paperPositions)
            .where((0, drizzle_orm_1.inArray)(schema_1.paperPositions.status, ['PAPER_WON', 'PAPER_LOST', 'SOLD_TP', 'SOLD_SL']))
            .get();
        let avgRoi = 0;
        if (pnlStats && pnlStats.totalCost > 0) {
            avgRoi = (pnlStats.totalRealized / pnlStats.totalCost) * 100;
        }
        const recentSignals = await db_1.db.select({
            id: schema_1.paperPositions.id,
            marketId: schema_1.markets.conditionId,
            question: schema_1.markets.question,
            action: (0, drizzle_orm_1.sql) `'BUY'`,
            price: schema_1.paperPositions.buyPrice,
            shares: schema_1.paperPositions.shares,
            cost: schema_1.paperPositions.totalCost,
            timestamp: schema_1.paperPositions.timestamp,
            status: schema_1.paperPositions.status
        })
            .from(schema_1.paperPositions)
            .innerJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.paperPositions.marketId, schema_1.markets.id))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.paperPositions.timestamp))
            .limit(50)
            .all();
        res.json({
            totalSignals,
            winRate: parseFloat(winRate.toFixed(1)),
            avgRoi: parseFloat(avgRoi.toFixed(1)),
            recentSignals
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Phase 13: Cache heavy SQL grouping to prevent Event Loop/SQLite starvation
let cachedIngestionStats = [];
async function refreshIngestionStats() {
    try {
        cachedIngestionStats = await db_1.db.select({
            marketId: schema_1.markets.conditionId,
            question: schema_1.markets.question,
            tradeCount: (0, drizzle_orm_1.sql) `COUNT(${schema_1.trades.id})`.mapWith(Number)
        })
            .from(schema_1.trades)
            .leftJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.trades.marketId, schema_1.markets.id))
            .groupBy(schema_1.trades.marketId)
            .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `COUNT(${schema_1.trades.id})`))
            .all();
    }
    catch (error) {
        console.error('[API] Background Caching Failed:', error);
    }
}
refreshIngestionStats();
setInterval(refreshIngestionStats, 30000);
// Get Ingestion Stats 
app.get('/api/stats/ingestion', async (req, res) => {
    try {
        const parentMarketsScraped = new Set(cachedIngestionStats.map(s => s.question)).size;
        const totalTrades = cachedIngestionStats.reduce((acc, curr) => acc + curr.tradeCount, 0);
        res.json({
            stats: cachedIngestionStats,
            subMarketsScraped: cachedIngestionStats.length,
            parentMarketsScraped,
            totalTrades
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Phase 21: Get N-Size Syndicates
app.get('/api/syndicates', async (req, res) => {
    try {
        const allSyndicates = await db_1.db.select().from(schema_1.syndicates).orderBy((0, drizzle_orm_1.desc)(schema_1.syndicates.size), (0, drizzle_orm_1.desc)(schema_1.syndicates.combinedPnL)).all();
        const allMembers = await db_1.db.select().from(schema_1.syndicateMembers).all();
        // Group members by syndicateId
        const membersMap = new Map();
        for (const m of allMembers) {
            if (!membersMap.has(m.syndicateId))
                membersMap.set(m.syndicateId, []);
            membersMap.get(m.syndicateId).push(m.walletAddress);
        }
        const payload = allSyndicates.map(s => ({
            ...s,
            members: membersMap.get(s.id) || []
        }));
        res.json(payload);
    }
    catch (error) {
        console.error('[API] /api/syndicates error:', error);
        res.status(500).json({ error: 'Failed to fetch syndicates' });
    }
});
// Phase 12: Get Syndicates
app.get('/api/stats/syndicates', async (req, res) => {
    try {
        const syndicates = await db_1.db.select()
            .from(schema_1.walletCorrelations)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.walletCorrelations.coOccurrenceCount))
            .limit(100)
            .all();
        res.json(syndicates);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Phase 33: Lifetime Accumulation Conviction API
app.get('/api/stats/conviction', async (req, res) => {
    try {
        // 1. Fetch only active (unresolved) markets to prevent alerting on expired data
        const activeMarkets = await db_1.db.select({
            id: schema_1.markets.id,
            conditionId: schema_1.markets.conditionId,
            question: schema_1.markets.question
        })
            .from(schema_1.markets)
            .where((0, drizzle_orm_1.eq)(schema_1.markets.resolved, false))
            .all();
        const activeMarketIds = activeMarkets.map(m => m.id);
        const activeMarketMap = new Map(activeMarkets.map(m => [m.id, m]));
        if (activeMarketIds.length === 0) {
            return res.json([]);
        }
        // 2. Fetch all Grade A/B Smart Money Wallets
        const smartMoneyWallets = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.inArray)(schema_1.wallets.grade, ['A', 'B'])).all();
        const smartMoneyIds = smartMoneyWallets.map(w => w.id);
        const smartMoneyMap = new Map(smartMoneyWallets.map(w => [w.id, w]));
        if (smartMoneyIds.length === 0) {
            return res.json([]);
        }
        // 3. Compute absolute Net Shares across Active Markets exclusively for Smart Money 
        const lifetimePositions = await db_1.db.select({
            marketId: schema_1.trades.marketId,
            walletId: schema_1.trades.walletId,
            outcomeIndex: schema_1.trades.outcomeIndex,
            netShares: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.trades.action} = 'BUY' THEN ${schema_1.trades.shares} ELSE -${schema_1.trades.shares} END)`.mapWith(Number)
        })
            .from(schema_1.trades)
            .where((0, drizzle_orm_1.inArray)(schema_1.trades.marketId, activeMarketIds))
            .groupBy(schema_1.trades.marketId, schema_1.trades.walletId, schema_1.trades.outcomeIndex)
            .all();
        // 4. Construct API Payload Leaderboard
        const marketConvictions = new Map();
        for (const mId of activeMarketIds) {
            const positiveHolders = lifetimePositions.filter(p => !!p && p.marketId === mId && p.netShares > 1 && smartMoneyIds.includes(p.walletId));
            if (positiveHolders.length === 0)
                continue;
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
            groupedOutcomes.sort((a, b) => b.holdersCount - a.holdersCount);
            const favoredGroup = groupedOutcomes[0];
            const secondFavoredGroup = groupedOutcomes.length > 1 ? groupedOutcomes[1] : { holdersCount: 0 };
            const netConviction = favoredGroup.holdersCount - secondFavoredGroup.holdersCount;
            if (netConviction === 0)
                continue;
            const marketMeta = activeMarketMap.get(mId);
            marketConvictions.set(mId, {
                marketId: marketMeta.conditionId,
                question: marketMeta.question,
                favoredOutcomeIndex: favoredGroup.outcomeIndex,
                netConviction,
                wallets: favoredGroup.holders.map(h => {
                    const w = smartMoneyMap.get(h.walletId);
                    return {
                        address: w.address,
                        grade: w.grade,
                        roi: w.recentRoi30d ?? 0,
                        netShares: h.netShares
                    };
                }).sort((a, b) => b.netShares - a.netShares) // Sort largest whale positions internally first
            });
        }
        // 5. Convert to Array and Sort by highest conviction descending
        const leaderboard = Array.from(marketConvictions.values()).sort((a, b) => b.netConviction - a.netConviction);
        res.json(leaderboard);
    }
    catch (error) {
        console.error('[API] /api/stats/conviction error:', error);
        res.status(500).json({ error: 'Failed to compute market convictions' });
    }
});
// Phase 12.1: Advanced Graph API
app.get('/api/syndicates/graph', async (req, res) => {
    try {
        // 1. Get raw correlations >= 4 (bumped noise threshold)
        const correlations = await db_1.db.select()
            .from(schema_1.walletCorrelations)
            .where((0, drizzle_orm_1.gte)(schema_1.walletCorrelations.coOccurrenceCount, 4))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.walletCorrelations.coOccurrenceCount))
            .all();
        // 2. Get unique wallet addresses involved
        const uniqueWallets = new Set();
        correlations.forEach(c => {
            uniqueWallets.add(c.walletA);
            uniqueWallets.add(c.walletB);
        });
        if (uniqueWallets.size === 0) {
            return res.json({ nodes: [], links: [] });
        }
        // 3. Query the wallets table for these addresses
        const walletData = await db_1.db.select({
            address: schema_1.wallets.address,
            grade: schema_1.wallets.grade,
            recentRoi30d: schema_1.wallets.recentRoi30d,
            winRate: schema_1.wallets.winRate
        })
            .from(schema_1.wallets)
            .where((0, drizzle_orm_1.inArray)(schema_1.wallets.address, Array.from(uniqueWallets)))
            .all();
        const walletMap = new Map();
        walletData.forEach(w => walletMap.set(w.address, w));
        // 4. Build standard Graph JSON structure
        const nodes = [];
        const links = [];
        walletMap.forEach((data, address) => {
            // STRICT FILTER: Ignore any nodes that are unrated (U) or null
            if (data.grade !== 'A' && data.grade !== 'B')
                return;
            nodes.push({
                id: address,
                group: data.grade,
                val: data.recentRoi30d ? Math.max(1, data.recentRoi30d) : 1, // Cap small values so nodes don't vanish
                winRate: data.winRate
            });
        });
        correlations.forEach(c => {
            // Only draw links if BOTH wallets passed the grade filter
            if (walletMap.has(c.walletA) && walletMap.has(c.walletB)) {
                const gradeA = walletMap.get(c.walletA).grade;
                const gradeB = walletMap.get(c.walletB).grade;
                if ((gradeA === 'A' || gradeA === 'B') && (gradeB === 'A' || gradeB === 'B')) {
                    links.push({
                        source: c.walletA,
                        target: c.walletB,
                        value: c.coOccurrenceCount
                    });
                }
            }
        });
        res.json({ nodes, links });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
function startApiServer(port = 3001) {
    // Phase 17: Interactive Wallet Drill-down
    app.get('/api/wallets/:address', async (req, res) => {
        try {
            const { address } = req.params;
            const walletData = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.address, address)).get();
            if (!walletData) {
                return res.status(404).json({ error: 'Wallet not found' });
            }
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 50;
            // Phase 31: True Aggregation + Paginated Scroller
            const recentTrades = await db_1.db.select({
                id: schema_1.trades.id,
                action: schema_1.trades.action,
                shares: (0, drizzle_orm_1.sql) `SUM(${schema_1.trades.shares})`.mapWith(Number),
                price: (0, drizzle_orm_1.sql) `AVG(${schema_1.trades.price})`.mapWith(Number),
                timestamp: schema_1.trades.timestamp,
                marketId: schema_1.markets.conditionId,
                question: schema_1.markets.question,
                icon: schema_1.markets.icon,
                subTrades: (0, drizzle_orm_1.sql) `COUNT(${schema_1.trades.id})`.mapWith(Number),
                cost: (0, drizzle_orm_1.sql) `SUM(${schema_1.trades.price} * ${schema_1.trades.shares})`.mapWith(Number)
            })
                .from(schema_1.trades)
                .leftJoin(schema_1.markets, (0, drizzle_orm_1.eq)(schema_1.trades.marketId, schema_1.markets.id))
                .where((0, drizzle_orm_1.eq)(schema_1.trades.walletId, walletData.id))
                .groupBy(schema_1.trades.timestamp, schema_1.trades.marketId, schema_1.trades.action)
                .orderBy((0, drizzle_orm_1.desc)(schema_1.trades.timestamp))
                .limit(limit)
                .offset((page - 1) * limit)
                .all();
            // Phase 22: Performance Chart running cash flow proxy
            const allTrades = await db_1.db.select({ action: schema_1.trades.action, shares: schema_1.trades.shares, price: schema_1.trades.price, timestamp: schema_1.trades.timestamp }).from(schema_1.trades).where((0, drizzle_orm_1.eq)(schema_1.trades.walletId, walletData.id)).orderBy((0, drizzle_orm_1.asc)(schema_1.trades.timestamp)).all();
            let cumulative = 0;
            const performanceChart = allTrades.map(t => {
                const val = Number(t.price) * Number(t.shares);
                cumulative += t.action === 'SELL' ? val : -val;
                return {
                    displayDate: new Date(t.timestamp).toLocaleDateString(),
                    cashFlow: cumulative
                };
            });
            res.json({
                metadata: walletData,
                recentTrades,
                performanceChart
            });
        }
        catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    // Phase 17: Interactive Market Drill-down
    app.get('/api/markets/:conditionId', async (req, res) => {
        try {
            const { conditionId } = req.params;
            const marketData = await db_1.db.select().from(schema_1.markets).where((0, drizzle_orm_1.eq)(schema_1.markets.conditionId, conditionId)).get();
            if (!marketData) {
                return res.status(404).json({ error: 'Market not found' });
            }
            res.json(marketData);
        }
        catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    app.listen(port, '127.0.0.1', () => {
        console.log(`🌐 Dashboard API Server running on http://127.0.0.1:${port}`);
    });
}
