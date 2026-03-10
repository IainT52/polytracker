import { db, client } from '../db';
import { trades } from '../db/schema';
import { sql } from 'drizzle-orm';

/**
 * Phase 44: Redemption Engine
 * Processes closed markets by injecting synthetic SELL trades for all outcomes.
 * Winning outcome = $1.00, Losing outcomes = $0.00.
 */
export async function processSyntheticRedemptions(
  marketId: number,
  conditionId: string,
  winningIndex: number,
  endDateStr: string
) {
  console.log(`[RedemptionEngine] Processing redemptions for Market ${marketId} (${conditionId.substring(0, 8)}...). Winning Index: ${winningIndex}`);

  try {
    const endDate = new Date(endDateStr);
    
    // 1. Calculate net shares for every wallet/outcome in this market
    // Constraint: Filter for net_shares > 1 to ignore floating-point dust.
    const rs = await client.execute({
      sql: `
        SELECT 
          wallet_id as walletId,
          outcome_index as outcomeIndex,
          SUM(CASE WHEN action = 'BUY' THEN shares ELSE -shares END) as net_shares
        FROM trades
        WHERE market_id = ?
        GROUP BY wallet_id, outcome_index
        HAVING net_shares > 1
      `,
      args: [marketId]
    });

    const holdings = rs.rows;
    if (holdings.length === 0) {
      console.log(`[RedemptionEngine] No eligible holdings (>1 share) found for market ${marketId}.`);
      return;
    }

    console.log(`[RedemptionEngine] Found ${holdings.length} holdings to resolve.`);

    // 2. Map holdings to synthetic SELL trades
    const syntheticTrades = holdings.map((row: any) => {
      const walletId = Number(row.walletId);
      const outcomeIndex = Number(row.outcomeIndex);
      const netShares = Number(row.net_shares);
      
      const isWinner = outcomeIndex === winningIndex;
      const price = isWinner ? 1.0 : 0.0;
      
      // Constraint: Deterministic hash to survive restarts
      const syntheticHash = `synthetic_redeem_${marketId}_${walletId}_${outcomeIndex}`;

      return {
        walletId,
        marketId,
        outcomeIndex,
        action: 'SELL',
        price,
        shares: netShares,
        timestamp: endDate,
        transactionHash: syntheticHash
      };
    });

    // 3. Bulk Insert with ON CONFLICT DO NOTHING
    // We'll insert in chunks of 100 to stay safe with SQLite/Drizzle limits
    const CHUNK_SIZE = 100;
    let insertedCount = 0;

    for (let i = 0; i < syntheticTrades.length; i += CHUNK_SIZE) {
      const chunk = syntheticTrades.slice(i, i + CHUNK_SIZE);
      
      // Drizzle doesn't have a clean 'onConflictDoNothing' for bulk insert in all drivers easily 
      // without raw SQL or specific syntax. We use raw SQL or batch for safest results.
      // Actually, drizzle-orm/sqlite-core has .onConflictDoNothing().
      
      await db.insert(trades)
        .values(chunk)
        .onConflictDoNothing()
        .run();
        
      insertedCount += chunk.length;
    }

    console.log(`[RedemptionEngine] Successfully queued/injected ${insertedCount} synthetic redemptions for Market ${marketId}.`);

  } catch (error: any) {
    console.error(`[RedemptionEngine] Critical failure processing market ${marketId}:`, error.message);
  }
}
