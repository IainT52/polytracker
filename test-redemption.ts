import { db, client } from './src/db';
import { markets, trades, wallets } from './src/db/schema';
import { eq, sql } from 'drizzle-orm';
import { processSyntheticRedemptions } from './src/engine/redemptionEngine';
import { runWalletGrader } from './src/engine/grader';

async function testRedemption() {
  console.log('--- Phase 44 Verification Script ---');

  // 1. Find a market with some trades but not yet resolved in our DB
  const sampleMarket = await db.select().from(markets).where(eq(markets.resolved, false)).limit(1).get();
  
  if (!sampleMarket) {
    console.log('No unresolved markets found in DB to test with.');
    return;
  }

  console.log(`Testing with Market: ${sampleMarket.question} (${sampleMarket.conditionId})`);

  // 2. Count current trades and holdings
  const holdings = await client.execute({
    sql: `
      SELECT COUNT(DISTINCT wallet_id) as holderCount
      FROM trades
      WHERE market_id = ?
    `,
    args: [sampleMarket.id]
  });
  console.log(`Current unique holders in this market: ${holdings.rows[0].holderCount}`);

  // 3. Manually trigger the redemption engine
  // We'll simulate Outcome 0 winning
  const winningIndex = 0;
  const endDate = sampleMarket.endDate || new Date().toISOString();

  console.log(`Simulating resolution: Outcome ${winningIndex} wins...`);
  await processSyntheticRedemptions(sampleMarket.id, sampleMarket.conditionId, winningIndex, endDate);

  // 4. Verify synthetic trades were injected
  const syntheticCount = await db.select({ count: sql<number>`count(*)` })
    .from(trades)
    .where(sql`transaction_hash LIKE 'synthetic_redeem_${sampleMarket.id}%'`)
    .get();

  console.log(`Verified: ${syntheticCount?.count} synthetic trades injected.`);

  // 5. Run the grader to see ROI impact
  console.log('Running Grader to update wallet metrics...');
  await runWalletGrader();

  // 6. Check a few wallets from this market to see if realizedPnL updated
  const updatedWallets = await client.execute({
    sql: `
      SELECT w.address, w.realized_pnl, w.roi, w.grade
      FROM wallets w
      JOIN trades t ON w.id = t.wallet_id
      WHERE t.market_id = ? AND t.transaction_hash LIKE 'synthetic_redeem_%'
      LIMIT 5
    `,
    args: [sampleMarket.id]
  });

  console.table(updatedWallets.rows);
  console.log('--- Verification Complete ---');
  process.exit(0);
}

testRedemption().catch(err => {
  console.error(err);
  process.exit(1);
});
