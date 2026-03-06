import express from 'express';
import cors from 'cors';
import { db } from '../db';
import { users, autoTradeConfigs, userPositions, paperPositions, markets, wallets, trades, walletCorrelations } from '../db/schema';
import { eq, desc, sql, gte, inArray } from 'drizzle-orm';
import { ethers } from 'ethers';
import { encryptKey } from '../bot/encryption';

const app = express();
app.use(cors());
app.use(express.json());

// Get dashboard config for a Telegram User ID
app.get('/api/config/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  try {
    let user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
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

// Get Top Rated Wallets
app.get('/api/stats/wallets', async (req, res) => {
  try {
    const topWallets = await db.select()
      .from(wallets)
      .where(eq(wallets.isBot, false))
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

    res.json({
      totalSignals,
      winRate: parseFloat(winRate.toFixed(1)),
      avgRoi: parseFloat(avgRoi.toFixed(1)),
      recentSignals: []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Phase 13: Cache heavy SQL grouping to prevent Event Loop/SQLite starvation
let cachedIngestionStats: any[] = [];
setInterval(async () => {
  try {
    cachedIngestionStats = await db.select({
      marketId: markets.conditionId,
      question: markets.question,
      tradeCount: sql<number>`COUNT(${trades.id})`.mapWith(Number)
    })
      .from(trades)
      .leftJoin(markets, eq(trades.marketId, markets.id))
      .groupBy(trades.marketId)
      .orderBy(desc(sql`COUNT(${trades.id})`))
      .all();
  } catch (error) {
    console.error('[API] Background Caching Failed:', error);
  }
}, 30000);

// Get Ingestion Stats 
app.get('/api/stats/ingestion', async (req, res) => {
  try {
    res.json(cachedIngestionStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
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
  app.listen(port, () => {
    console.log(`🌐 Dashboard API Server running on http://localhost:${port}`);
  });
}
