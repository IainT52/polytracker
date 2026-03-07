import { db, client } from '../db';
import { wallets } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Calculates grades for all wallets using a SQL-Native CTE.
 * Designed for High-Volume Ingestion (Phase 10) to prevent OOM crashes.
 */
export async function runWalletGrader() {
  console.log('[Grader] Running SQL-Native Wallet Grading...');

  const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);

  const rs = await client.execute({
    sql: `
    WITH PositionStats AS (
      SELECT 
        wallet_id,
        market_id,
        outcome_index,
        SUM(CASE WHEN action = 'BUY' THEN shares ELSE 0 END) AS shares_bought,
        SUM(CASE WHEN action = 'SELL' THEN shares ELSE 0 END) AS shares_sold,
        SUM(CASE WHEN action = 'BUY' THEN price * shares ELSE 0 END) AS total_spent,
        SUM(CASE WHEN action = 'SELL' THEN price * shares ELSE 0 END) AS total_earned,
        SUM(price * shares) AS volume,
        COUNT(id) AS trade_count,
        
        -- 30-Day Recency Isolations
        SUM(CASE WHEN timestamp >= ? AND action = 'BUY' THEN shares ELSE 0 END) AS recent_shares_bought,
        SUM(CASE WHEN timestamp >= ? AND action = 'SELL' THEN shares ELSE 0 END) AS recent_shares_sold,
        SUM(CASE WHEN timestamp >= ? AND action = 'BUY' THEN price * shares ELSE 0 END) AS recent_total_spent,
        SUM(CASE WHEN timestamp >= ? AND action = 'SELL' THEN price * shares ELSE 0 END) AS recent_total_earned,
        SUM(CASE WHEN timestamp >= ? THEN price * shares ELSE 0 END) AS recent_volume,
        SUM(CASE WHEN timestamp >= ? THEN 1 ELSE 0 END) AS recent_trade_count
      FROM trades
      GROUP BY wallet_id, market_id, outcome_index
    )
    SELECT 
      wallet_id AS walletId,
      SUM(trade_count) AS totalTrades,
      SUM(volume) AS totalVolume,
      SUM(
        CASE 
          WHEN shares_bought > 0 THEN 
            total_earned - (shares_sold * (total_spent / shares_bought))
          ELSE 0 
        END
      ) AS realizedPnL,
      SUM(
        CASE 
          WHEN shares_bought > 0 AND shares_sold > 0 
               AND (total_earned / shares_sold) > (total_spent / shares_bought) THEN 1
          ELSE 0
        END
      ) AS winningPositions,
      SUM(CASE WHEN shares_sold > 0 THEN 1 ELSE 0 END) AS closedPositions,
      
      -- 30-Day Aggregations
      SUM(recent_trade_count) AS recentTrades,
      SUM(recent_volume) AS recentVolume,
      SUM(
        CASE 
          WHEN recent_shares_bought > 0 THEN 
            recent_total_earned - (recent_shares_sold * (recent_total_spent / recent_shares_bought))
          ELSE 0 
        END
      ) AS recentRealizedPnL,
      SUM(
        CASE 
          WHEN recent_shares_bought > 0 AND recent_shares_sold > 0 
               AND (recent_total_earned / recent_shares_sold) > (recent_total_spent / recent_shares_bought) THEN 1
          ELSE 0
        END
      ) AS recentWinningPositions,
      SUM(CASE WHEN recent_shares_sold > 0 THEN 1 ELSE 0 END) AS recentClosedPositions
    FROM PositionStats
    GROUP BY wallet_id
    `,
    args: [thirtyDaysAgoMs, thirtyDaysAgoMs, thirtyDaysAgoMs, thirtyDaysAgoMs, thirtyDaysAgoMs, thirtyDaysAgoMs]
  });

  const aggregatedStats = rs.rows;
  console.log(`[Grader] Calculated metrics for ${aggregatedStats.length} wallets in SQLite.`);

  const updates: any[] = [];

  for (const stats of aggregatedStats) {
    let grade = 'D';

    const walletId = Number(stats.walletId);
    const totalTrades = Number(stats.totalTrades);
    const totalVolume = Number(stats.totalVolume);
    const realizedPnL = Number(stats.realizedPnL);
    const winningPositions = Number(stats.winningPositions);
    const closedPositions = Number(stats.closedPositions);

    // 30-day stats
    const recentVolume = Number(stats.recentVolume);
    const recentRealizedPnL = Number(stats.recentRealizedPnL);
    const recentWinningPositions = Number(stats.recentWinningPositions);
    const recentClosedPositions = Number(stats.recentClosedPositions);

    // Protect against division by zero for ROI and WinRate
    const roi = totalVolume > 0 ? (realizedPnL / totalVolume) * 100 : 0;
    const winRate = closedPositions > 0 ? (winningPositions / closedPositions) * 100 : 0;

    const recentRoi30d = recentVolume > 0 ? (recentRealizedPnL / recentVolume) * 100 : 0;
    const recentWinRate30d = recentClosedPositions > 0 ? (recentWinningPositions / recentClosedPositions) * 100 : 0;

    // High Liquidity filters (All-time baselines)
    if (totalTrades >= 30 && totalVolume >= 10000) {
      if (roi > 25 && winRate > 60) grade = 'A';
      else if (roi > 10 && winRate > 50) grade = 'B';
      else if (roi > 0) grade = 'C';
    } else if (roi > 0) {
      grade = 'C';
    }

    // Phase 11 Decay Discarding: A wallet MUST have a positive recentRoi30d to maintain Grade A/B
    if ((grade === 'A' || grade === 'B') && recentRoi30d <= 0) {
      console.log(`[Grader] Demoting decaying whale ${walletId} from ${grade} -> C (Recent ROI: ${recentRoi30d.toFixed(2)}%)`);
      grade = 'C';
    }

    updates.push({
      id: walletId,
      grade,
      roi,
      winRate,
      recentRoi30d,
      recentWinRate30d,
      totalTrades,
      totalVolume,
      realizedPnL,
      lastAnalyzed: new Date(),
    });
  }

  console.log(`[Grader] Batching SQLite DB writes for ${updates.length} wallets...`);

  // Batch updates in SQLite natively to avoid N+1 bottleneck and Node.js proxy segfaults
  const CHUNK_SIZE = 500;
  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);

    const batchQueries: any[] = chunk.map(update =>
      db.update(wallets)
        .set({
          grade: update.grade,
          roi: update.roi,
          winRate: update.winRate,
          recentRoi30d: update.recentRoi30d,
          recentWinRate30d: update.recentWinRate30d,
          totalTrades: update.totalTrades,
          totalVolume: update.totalVolume,
          realizedPnL: update.realizedPnL,
          lastAnalyzed: update.lastAnalyzed
        })
        .where(eq(wallets.id, update.id))
    );

    // native batch pushes everything in a single driver instruction, freeing NodeJS V8 from context exhaustion
    // @ts-ignore
    await db.batch(batchQueries);
  }

  console.log('[Grader] Finished SQL grading block.');
}
