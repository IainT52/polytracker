import express from 'express';
import cors from 'cors';
import { db } from '../db';
import { users, autoTradeConfigs, userPositions, paperPositions, markets, wallets, trades, walletCorrelations, syndicates, syndicateMembers } from '../db/schema';
import { eq, desc, asc, sql, gte, inArray, and } from 'drizzle-orm';
import { ethers } from 'ethers';
import { encryptKey } from '../bot/encryption';

const app = express();
app.use(cors());
app.use(express.json());

// Get dashboard config for a Telegram User ID
app.get('/api/config/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  console.log(`[API] Endpoint /api/config reached for telegram ID: ${telegramId}`);
  try {
    console.log(`[API] Attempting db.select().from(users)...`);
    let user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    console.log(`[API] db.select().from(users) completed.`);
    if (!user) {
      console.log(`[API] Auto-creating demo user for telegram ID: ${telegramId}`);
      const wallet = ethers.Wallet.createRandom();
      const insertResult = await db.insert(users).values({
        telegramId,
        username: 'DemoUser',
        encryptedPrivateKey: encryptKey('0x0000000000000000000000000000000000000000000000000000000000000000') // Bypassing missing process.env.ENCRYPTION_KEY locally if needed
      }).onConflictDoUpdate({
        target: users.telegramId,
        set: { telegramId } // Dummy update to return row
      }).returning();
      user = insertResult[0];
    }

    let config = await db.select().from(autoTradeConfigs).where(eq(autoTradeConfigs.userId, user.id)).get();

    // Create default config if none exists
    if (!config) {
      [config] = await db.insert(autoTradeConfigs).values({
        userId: user.id
      }).returning();
    }

    res.json(config);
  } catch (error) {
    console.error("FATAL CONFIG ERROR:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update dashboard config
app.post('/api/config/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  const updates = req.body;

  try {
    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Validate updates
    const sanitizedUpdates: any = {};
    if (updates.isAutoTradeEnabled !== undefined) sanitizedUpdates.isAutoTradeEnabled = Boolean(updates.isAutoTradeEnabled);
    if (updates.isPaperTradingMode !== undefined) sanitizedUpdates.isPaperTradingMode = Boolean(updates.isPaperTradingMode);
    if (updates.maxSpreadBps !== undefined) sanitizedUpdates.maxSpreadBps = Number(updates.maxSpreadBps);
    if (updates.maxSlippageCents !== undefined) sanitizedUpdates.maxSlippageCents = Number(updates.maxSlippageCents);
    if (updates.minOrderbookLiquidityUsd !== undefined) sanitizedUpdates.minOrderbookLiquidityUsd = String(updates.minOrderbookLiquidityUsd);
    if (updates.fixedBetSizeUsd !== undefined) sanitizedUpdates.fixedBetSizeUsd = String(updates.fixedBetSizeUsd);
    if (updates.takeProfitPct !== undefined) sanitizedUpdates.takeProfitPct = Number(updates.takeProfitPct);
    if (updates.stopLossPct !== undefined) sanitizedUpdates.stopLossPct = Number(updates.stopLossPct);

    // Phase 11: Dynamic Sizing Parameters
    if (updates.minWhalesToTrigger !== undefined) sanitizedUpdates.minWhalesToTrigger = Number(updates.minWhalesToTrigger);
    if (updates.dynamicSizingEnabled !== undefined) sanitizedUpdates.dynamicSizingEnabled = Boolean(updates.dynamicSizingEnabled);
    if (updates.convictionMultiplier !== undefined) sanitizedUpdates.convictionMultiplier = Number(updates.convictionMultiplier);

    const config = await db.update(autoTradeConfigs)
      .set(sanitizedUpdates)
      .where(eq(autoTradeConfigs.userId, user.id))
      .returning()
      .get();

    res.json(config);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get recent trades (positions & paper positions)
app.get('/api/positions/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  try {
    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (!user) return res.json([]);

    const realPositions = await db.select({
      id: userPositions.id,
      marketId: userPositions.marketId,
      question: markets.question,
      buyPrice: userPositions.buyPrice,
      shares: userPositions.shares,
      totalCost: userPositions.totalCost,
      timestamp: userPositions.timestamp,
      status: userPositions.status,
      isPaper: sql`0`.as('isPaper')
    })
      .from(userPositions)
      .leftJoin(markets, eq(userPositions.marketId, markets.id))
      .where(eq(userPositions.userId, user.id));

    const simPositions = await db.select({
      id: paperPositions.id,
      marketId: paperPositions.marketId,
      question: markets.question,
      buyPrice: paperPositions.buyPrice,
      shares: paperPositions.shares,
      totalCost: paperPositions.totalCost,
      timestamp: paperPositions.timestamp,
      status: paperPositions.status,
      isPaper: sql`1`.as('isPaper')
    })
      .from(paperPositions)
      .leftJoin(markets, eq(paperPositions.marketId, markets.id))
      .where(eq(paperPositions.userId, user.id));

    // Combine and sort
    const allPositions = [...realPositions, ...simPositions].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 50);

    res.json(allPositions);
  } catch (error) {
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
    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const config = await db.select().from(autoTradeConfigs).where(eq(autoTradeConfigs.userId, user.id)).get();
    if (!config) return res.status(400).json({ error: 'Config missing' });

    // Phase 14: Authentic SQL Simulation
    // Find historical trades made by Grade A/B wallets in this timeframe
    const fromDate = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = endDate ? new Date(endDate) : new Date();

    const smartHistoricalTrades = await db.select({
      id: trades.id,
      marketId: trades.marketId,
      question: markets.question,
      outcomeIndex: trades.outcomeIndex,
      price: trades.price,
      action: trades.action,
      timestamp: trades.timestamp,
      walletGrade: wallets.grade
    })
      .from(trades)
      .innerJoin(wallets, eq(trades.walletId, wallets.id))
      .innerJoin(markets, eq(trades.marketId, markets.id))
      .where(
        sql`${wallets.grade} IN ('A', 'B') 
        AND ${trades.timestamp} >= ${fromDate} 
        AND ${trades.timestamp} <= ${toDate}`
      )
      .orderBy(desc(trades.timestamp))
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get Top Rated Wallets with Dynamic Filters
app.get('/api/stats/wallets', async (req, res) => {
  try {
    const { grade, minTrades, minVolume, minWinRate, minRoi } = req.query;

    const conditions = [eq(wallets.isBot, false)];

    if (grade && grade !== 'ALL') {
      conditions.push(eq(wallets.grade, String(grade)));
    }
    if (minTrades && !isNaN(Number(minTrades))) {
      conditions.push(gte(wallets.totalTrades, Number(minTrades)));
    }
    if (minVolume && !isNaN(Number(minVolume))) {
      conditions.push(gte(wallets.totalVolume, Number(minVolume)));
    }
    if (minWinRate && !isNaN(Number(minWinRate))) {
      conditions.push(gte(wallets.winRate, Number(minWinRate)));
    }
    if (minRoi && !isNaN(Number(minRoi))) {
      conditions.push(gte(wallets.roi, Number(minRoi)));
    }

    const topWallets = await db.select()
      .from(wallets)
      .where(and(...conditions))
      .orderBy(desc(wallets.roi))
      .limit(50);

    res.json(topWallets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get aggregate signal stats (mocked for visualization)
app.get('/api/stats/signals', async (req, res) => {
  try {
    const totalSignalsRes = await db.select({ count: sql<number>`COUNT(*)` }).from(paperPositions).get();
    const totalSignals = totalSignalsRes?.count || 0;

    const winsRes = await db.select({ count: sql<number>`COUNT(*)` })
      .from(paperPositions)
      .where(inArray(paperPositions.status, ['PAPER_WON', 'SOLD_TP']))
      .get();

    const resolvedRes = await db.select({ count: sql<number>`COUNT(*)` })
      .from(paperPositions)
      .where(inArray(paperPositions.status, ['PAPER_WON', 'PAPER_LOST', 'SOLD_TP', 'SOLD_SL']))
      .get();

    const wins = winsRes?.count || 0;
    const resolved = resolvedRes?.count || 0;
    const winRate = resolved > 0 ? (wins / resolved) * 100 : 0;

    // Avg ROI
    const pnlStats = await db.select({
      totalRealized: sql<number>`SUM(CAST(${paperPositions.realizedPnL} AS REAL))`,
      totalCost: sql<number>`SUM(CAST(${paperPositions.totalCost} AS REAL))`
    }).from(paperPositions)
      .where(inArray(paperPositions.status, ['PAPER_WON', 'PAPER_LOST', 'SOLD_TP', 'SOLD_SL']))
      .get();

    let avgRoi = 0;
    if (pnlStats && pnlStats.totalCost > 0) {
      avgRoi = (pnlStats.totalRealized / pnlStats.totalCost) * 100;
    }

    const recentSignals = await db.select({
      id: paperPositions.id,
      marketId: markets.conditionId,
      question: markets.question,
      action: sql<string>`'BUY'`,
      price: paperPositions.buyPrice,
      shares: paperPositions.shares,
      cost: paperPositions.totalCost,
      timestamp: paperPositions.timestamp,
      status: paperPositions.status
    })
      .from(paperPositions)
      .innerJoin(markets, eq(paperPositions.marketId, markets.id))
      .orderBy(desc(paperPositions.timestamp))
      .limit(50)
      .all();

    res.json({
      totalSignals,
      winRate: parseFloat(winRate.toFixed(1)),
      avgRoi: parseFloat(avgRoi.toFixed(1)),
      recentSignals
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase 13: Cache heavy SQL grouping to prevent Event Loop/SQLite starvation
let cachedIngestionStats: any[] = [];
let cachedTotalTrades: number = 0;
let cachedActiveMarkets: number = 0;

async function refreshIngestionStats() {
  try {
    // 1. O(1) Header calculation for pure totals
    const tradesRes = await db.select({ count: sql<number>`COUNT(*)` }).from(trades).get();
    cachedTotalTrades = tradesRes?.count || 0;

    const marketsRes = await db.select({ count: sql<number>`COUNT(*)` }).from(markets).where(eq(markets.resolved, false)).get();
    cachedActiveMarkets = marketsRes?.count || 0;

    // 2. Limit the massive groupBy matrix purely to the Top 50 required for the UI Array representation
    cachedIngestionStats = await db.select({
      marketId: markets.conditionId,
      question: markets.question,
      tradeCount: sql<number>`COUNT(${trades.id})`.mapWith(Number)
    })
      .from(trades)
      .leftJoin(markets, eq(trades.marketId, markets.id))
      .groupBy(trades.marketId)
      .orderBy(desc(sql`COUNT(${trades.id})`))
      .limit(50)
      .all();
  } catch (error) {
    console.error('[API] Background Caching Failed:', error);
  }
}

refreshIngestionStats();
setInterval(refreshIngestionStats, 60000); // Poll every 60 seconds

// Get Ingestion Stats 
app.get('/api/stats/ingestion', async (req, res) => {
  try {
    const parentMarketsScraped = new Set(cachedIngestionStats.map(s => s.question)).size;
    res.json({
      stats: cachedIngestionStats,
      subMarketsScraped: cachedActiveMarkets,
      parentMarketsScraped,
      totalTrades: cachedTotalTrades
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase 21: Get N-Size Syndicates
app.get('/api/syndicates', async (req, res) => {
  try {
    const allSyndicates = await db.select().from(syndicates).orderBy(desc(syndicates.size), desc(syndicates.combinedPnL)).all();
    const allMembers = await db.select().from(syndicateMembers).all();

    // Group members by syndicateId
    const membersMap = new Map<number, string[]>();
    for (const m of allMembers) {
      if (!membersMap.has(m.syndicateId)) membersMap.set(m.syndicateId, []);
      membersMap.get(m.syndicateId)!.push(m.walletAddress);
    }

    const payload = allSyndicates.map(s => ({
      ...s,
      members: membersMap.get(s.id) || []
    }));

    res.json(payload);
  } catch (error) {
    console.error('[API] /api/syndicates error:', error);
    res.status(500).json({ error: 'Failed to fetch syndicates' });
  }
});

// Phase 12: Get Syndicates
app.get('/api/stats/syndicates', async (req, res) => {
  try {
    const syndicates = await db.select()
      .from(walletCorrelations)
      .orderBy(desc(walletCorrelations.coOccurrenceCount))
      .limit(100)
      .all();
    res.json(syndicates);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase 33: Lifetime Accumulation Conviction API
app.get('/api/stats/conviction', async (req, res) => {
  try {
    // 1. Fetch only active (unresolved) markets to prevent alerting on expired data
    const activeMarkets = await db.select({
      id: markets.id,
      conditionId: markets.conditionId,
      question: markets.question
    })
      .from(markets)
      .where(eq(markets.resolved, false))
      .all();

    const activeMarketIds = activeMarkets.map(m => m.id);
    const activeMarketMap = new Map(activeMarkets.map(m => [m.id, m]));

    if (activeMarketIds.length === 0) {
      return res.json([]);
    }

    // 2. Fetch all Grade A/B Smart Money Wallets
    const smartMoneyWallets = await db.select().from(wallets).where(inArray(wallets.grade, ['A', 'B'])).all();
    const smartMoneyIds = smartMoneyWallets.map(w => w.id);
    const smartMoneyMap = new Map(smartMoneyWallets.map(w => [w.id, w]));

    if (smartMoneyIds.length === 0) {
      return res.json([]);
    }

    // 3. Compute absolute Net Shares across Active Markets exclusively for Smart Money 
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

    // 4. Construct API Payload Leaderboard
    const marketConvictions = new Map<number, { marketId: string, question: string, favoredOutcomeIndex: number, netConviction: number, wallets: any[] }>();

    for (const mId of activeMarketIds) {
      const positiveHolders = lifetimePositions.filter(p => !!p && p.marketId === mId && p.netShares > 1 && smartMoneyIds.includes(p.walletId));
      if (positiveHolders.length === 0) continue;

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

      groupedOutcomes.sort((a, b) => b.holdersCount - a.holdersCount);

      const favoredGroup = groupedOutcomes[0];
      const secondFavoredGroup = groupedOutcomes.length > 1 ? groupedOutcomes[1] : { holdersCount: 0 };

      const netConviction = favoredGroup.holdersCount - secondFavoredGroup.holdersCount;
      if (netConviction === 0) continue;

      const marketMeta = activeMarketMap.get(mId)!;

      marketConvictions.set(mId, {
        marketId: marketMeta.conditionId,
        question: marketMeta.question,
        favoredOutcomeIndex: favoredGroup.outcomeIndex,
        netConviction,
        wallets: favoredGroup.holders.map(h => {
          const w = smartMoneyMap.get(h.walletId)!;
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
  } catch (error) {
    console.error('[API] /api/stats/conviction error:', error);
    res.status(500).json({ error: 'Failed to compute market convictions' });
  }
});

// Phase 12.1: Advanced Graph API
app.get('/api/syndicates/graph', async (req, res) => {
  try {
    // 1. Get raw correlations >= 4 (bumped noise threshold)
    const correlations = await db.select()
      .from(walletCorrelations)
      .where(gte(walletCorrelations.coOccurrenceCount, 4))
      .orderBy(desc(walletCorrelations.coOccurrenceCount))
      .all();

    // 2. Get unique wallet addresses involved
    const uniqueWallets = new Set<string>();
    correlations.forEach(c => {
      uniqueWallets.add(c.walletA);
      uniqueWallets.add(c.walletB);
    });

    if (uniqueWallets.size === 0) {
      return res.json({ nodes: [], links: [] });
    }

    // 3. Query the wallets table for these addresses
    const walletData = await db.select({
      address: wallets.address,
      grade: wallets.grade,
      recentRoi30d: wallets.recentRoi30d,
      winRate: wallets.winRate
    })
      .from(wallets)
      .where(inArray(wallets.address, Array.from(uniqueWallets)))
      .all();

    const walletMap = new Map();
    walletData.forEach(w => walletMap.set(w.address, w));

    // 4. Build standard Graph JSON structure
    const nodes: any[] = [];
    const links: any[] = [];

    walletMap.forEach((data, address) => {
      // STRICT FILTER: Ignore any nodes that are unrated (U) or null
      if (data.grade !== 'A' && data.grade !== 'B') return;

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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export function startApiServer(port = 3001) {
  // Phase 17: Interactive Wallet Drill-down
  app.get('/api/wallets/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const walletData = await db.select().from(wallets).where(eq(wallets.address, address)).get();

      if (!walletData) {
        return res.status(404).json({ error: 'Wallet not found' });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      // Phase 31: True Aggregation + Paginated Scroller
      const recentTrades = await db.select({
        id: trades.id,
        action: trades.action,
        shares: sql<number>`SUM(${trades.shares})`.mapWith(Number),
        price: sql<number>`AVG(${trades.price})`.mapWith(Number),
        timestamp: trades.timestamp,
        marketId: markets.conditionId,
        question: markets.question,
        icon: markets.icon,
        subTrades: sql<number>`COUNT(${trades.id})`.mapWith(Number),
        cost: sql<number>`SUM(${trades.price} * ${trades.shares})`.mapWith(Number)
      })
        .from(trades)
        .leftJoin(markets, eq(trades.marketId, markets.id))
        .where(eq(trades.walletId, walletData.id))
        .groupBy(trades.timestamp, trades.marketId, trades.action)
        .orderBy(desc(trades.timestamp))
        .limit(limit)
        .offset((page - 1) * limit)
        .all();

      // Phase 22: Performance Chart running cash flow proxy
      const allTrades = await db.select({ action: trades.action, shares: trades.shares, price: trades.price, timestamp: trades.timestamp }).from(trades).where(eq(trades.walletId, walletData.id)).orderBy(asc(trades.timestamp)).all();

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
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Phase 17: Interactive Market Drill-down
  app.get('/api/markets/:conditionId', async (req, res) => {
    try {
      const { conditionId } = req.params;
      const marketData = await db.select().from(markets).where(eq(markets.conditionId, conditionId)).get();

      if (!marketData) {
        return res.status(404).json({ error: 'Market not found' });
      }

      res.json(marketData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.listen(port, '127.0.0.1', () => {
    console.log(`🌐 Dashboard API Server running on http://127.0.0.1:${port}`);
  });
}
