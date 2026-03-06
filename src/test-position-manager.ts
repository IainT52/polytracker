import { db } from './db';
import { autoTradeConfigs, users, markets, paperPositions } from './db/schema';
import { managePositions } from './services/positionManager';
import { eq } from 'drizzle-orm';

async function runTest() {
  console.log('--- Setting up DB Mock Data ---');

  // Insert Mock User & Config
  const [user] = await db.insert(users).values({
    telegramId: `bot-tp-tester-${Date.now()}`
  }).returning();

  await db.insert(autoTradeConfigs).values({
    userId: user.id,
    takeProfitPct: 50, // Set TP to +50%
    stopLossPct: 20
  });

  // Insert Mock Market
  const [market] = await db.insert(markets).values({
    conditionId: `0xTPTestCond${Date.now()}`,
    question: 'Will this hit Take Profit?',
    outcomes: '["Yes", "No"]'
  }).returning();

  // Insert mock PAPER_OPEN position bought at $0.40
  const [position] = await db.insert(paperPositions).values({
    userId: user.id,
    marketId: market.id,
    outcomeIndex: 0,
    buyPrice: '0.40',
    shares: '100', // Total Cost = $40
    totalCost: '40',
    status: 'PAPER_OPEN'
  }).returning();

  console.log(`Created PAPER_OPEN Position ${position.id} @ $0.40`);

  // Mock global.fetch to intercept fetchWithRetry
  const originalFetch = global.fetch;
  (global as any).fetch = async (url: string) => {
    if (url.includes('/book?token_id=')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          bids: [{ price: '0.60', size: '200' }], // 200 shares available at $0.60, covers our 100 shares
          asks: []
        })
      };
    }
    return originalFetch(url);
  };

  console.log('--- Running Position Manager Loop ---');
  await managePositions();

  // Restore fetch
  (global as any).fetch = originalFetch;

  // Verify
  const updatedPos = await db.select().from(paperPositions).where(eq(paperPositions.id, position.id)).get();

  console.log('--- Results ---');
  console.log(`Original Status: PAPER_OPEN`);
  console.log(`New Status: ${updatedPos?.status}`);
  console.log(`Resolved Price: ${updatedPos?.resolvedPrice}`);
  console.log(`Realized PnL: ${updatedPos?.realizedPnL}`);

  if (updatedPos?.status === 'SOLD_TP' && updatedPos?.realizedPnL === '20.00') {
    console.log('✅ TEST PASSED: Successfully identified +50% gain, simulated TP, and updated DB.');
  } else {
    console.log('❌ TEST FAILED');
  }

  process.exit(0);
}

runTest().catch(console.error);
