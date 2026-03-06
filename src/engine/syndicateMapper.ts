import { db } from '../db';
import { sql } from 'drizzle-orm';
import { walletCorrelations } from '../db/schema';

export async function mapSyndicates() {
  console.log('[SyndicateMapper] Starting offline temporal correlation analysis...');
  const startTime = Date.now();

  try {
    // Phase 12: Offline Temporal Self-Join
    // 300,000 ms = 5 minutes
    const rs = await db.run(sql`
      WITH SyndicatePairs AS (
        SELECT
          t1.wallet_id AS wallet_a,
          t2.wallet_id AS wallet_b,
          COUNT(DISTINCT t1.market_id) AS co_occurrence_count,
          MAX(MAX(t1.timestamp), MAX(t2.timestamp)) AS last_seen_together
        FROM trades t1
        JOIN trades t2 
          ON t1.market_id = t2.market_id 
          AND t1.outcome_index = t2.outcome_index
        WHERE 
          t1.wallet_id < t2.wallet_id -- Prevent A->B and B->A duplication & self matches
          AND t1.action = 'BUY' 
          AND t2.action = 'BUY'
          AND ABS(t1.timestamp - t2.timestamp) < 300000 
        GROUP BY 
          t1.wallet_id, t2.wallet_id
        HAVING 
          COUNT(DISTINCT t1.market_id) >= 3
      )
      INSERT INTO wallet_correlations (wallet_a, wallet_b, co_occurrence_count, last_seen_together)
      SELECT 
        wA.address,
        wB.address,
        sp.co_occurrence_count,
        sp.last_seen_together
      FROM SyndicatePairs sp
      JOIN wallets wA ON wA.id = sp.wallet_a
      JOIN wallets wB ON wB.id = sp.wallet_b
      WHERE 1=1
      ON CONFLICT(wallet_a, wallet_b) DO UPDATE SET 
        co_occurrence_count = excluded.co_occurrence_count,
        last_seen_together = excluded.last_seen_together;
    `);

    const elapsed = Date.now() - startTime;
    console.log(`[SyndicateMapper] Correlation analysis complete in ${elapsed}ms.`);
    // Using rs.changes to see how many rows were inserted/updated
    console.log(`[SyndicateMapper] Upserted rows: ${rs.rowsAffected}`);

  } catch (error) {
    console.error('[SyndicateMapper] Error mapping syndicates:', error);
  }
}

// Allow running directly
if (require.main === module) {
  mapSyndicates().then(() => {
    console.log('Done.');
    process.exit(0);
  });
}
