import { db } from '../db';
import { sql } from 'drizzle-orm';
import { walletCorrelations } from '../db/schema';

export async function mapSyndicates() {
  console.log('[SyndicateMapper] Starting offline temporal correlation analysis...');
  const startTime = Date.now();

  try {
    // Phase 12: Offline Temporal Self-Join
    // 300,000 ms = 5 minutes
    // 1. Fetch the raw correlations into Node memory
    const pairs = await db.all(sql`
      SELECT
        t1.wallet_id AS wallet_a,
        t2.wallet_id AS wallet_b,
        COUNT(DISTINCT t1.market_id) AS co_occurrence_count,
        MAX(MAX(t1.timestamp), MAX(t2.timestamp)) AS last_seen_together
      FROM trades t1
      JOIN trades t2 
        ON t1.market_id = t2.market_id 
        AND t1.outcome_index = t2.outcome_index
      INNER JOIN wallets w1 ON t1.wallet_id = w1.address AND w1.grade IN ('A', 'B')
      INNER JOIN wallets w2 ON t2.wallet_id = w2.address AND w2.grade IN ('A', 'B')
      WHERE 
        t1.wallet_id < t2.wallet_id 
        AND t1.action = 'BUY' 
        AND t2.action = 'BUY'
        AND ABS(t1.timestamp - t2.timestamp) < 300000 
      GROUP BY 
        t1.wallet_id, t2.wallet_id
      HAVING 
        COUNT(DISTINCT t1.market_id) >= 3
    `);

    // 2. Chunk and insert using Drizzle to prevent SQLite Parameter limit crashes
    let totalInserted = 0;
    const CHUNK_SIZE = 100; // 100 rows * 4 cols = 400 params (< 999 max)

    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
      const chunk = pairs.slice(i, i + CHUNK_SIZE).map((p: any) => ({
        walletA: p.wallet_a,
        walletB: p.wallet_b,
        coOccurrenceCount: p.co_occurrence_count,
        lastSeenTogether: p.last_seen_together
      }));

      await db.transaction(async (tx) => {
        await tx.insert(walletCorrelations)
          .values(chunk)
          .onConflictDoUpdate({
            target: [walletCorrelations.walletA, walletCorrelations.walletB],
            set: {
              coOccurrenceCount: sql`excluded.co_occurrence_count`,
              lastSeenTogether: sql`excluded.last_seen_together`
            }
          });
      });
      totalInserted += chunk.length;
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SyndicateMapper] Correlation analysis complete in ${elapsed}ms.`);
    console.log(`[SyndicateMapper] Upserted rows: ${totalInserted}`);

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
