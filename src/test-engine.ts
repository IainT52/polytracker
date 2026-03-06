import { runWalletGrader } from './engine/grader';
import { processTradeForAlphaSignal } from './engine/signalEngine';
import { db } from './db';
import { wallets, trades, markets } from './db/schema';

async function verifyEngine() {
  console.log('--- Phase 3 Verification: Scoring & Alert Engine ---');

  // 1. Setup Mock DB State
  const [mockMarket] = await db.insert(markets).values({
    conditionId: '0xMockMarketEngine123',
    question: 'Will AI take over grading?',
    outcomes: '["Yes", "No"]'
  }).returning();

  const [wallet1] = await db.insert(wallets).values({ address: '0xMockSmartMoneyA123', grade: 'D' }).returning();
  const [wallet2] = await db.insert(wallets).values({ address: '0xMockSmartMoneyB456', grade: 'C' }).returning();

  // Create enough mock volume for wallet 2 to eventually pass the grader
  for (let i = 0; i < 35; i++) {
    await db.insert(trades).values({
      walletId: wallet2.id, marketId: mockMarket.id, outcomeIndex: 0, action: 'BUY', price: 0.50, shares: 1000
    });
  }

  // 2. Test Grader (Should upgrade wallet1 and wallet2 based on volume/simulations)
  await runWalletGrader();

  // 3. Test Alpha Signal
  console.log('\n>> Testing Alpha Signal Conditions');

  // Wallet 1 buys at $0.40
  console.log('[Test] Wallet 1 buys at $0.40');
  const [trade1] = await db.insert(trades).values({
    walletId: wallet1.id, marketId: mockMarket.id, outcomeIndex: 0, action: 'BUY', price: 0.40, shares: 100
  }).returning();
  await processTradeForAlphaSignal(trade1.id, wallet1.id, mockMarket.id, 0, 0.40, new Date());

  // Wallet 2 buys at $0.60 (Difference is $0.20 -> SHOULD NOT TRIGGER)
  console.log('[Test] Wallet 2 buys at $0.60 (Price diff > $0.10, NO SIGNAL)');
  const [trade2] = await db.insert(trades).values({
    walletId: wallet2.id, marketId: mockMarket.id, outcomeIndex: 0, action: 'BUY', price: 0.60, shares: 100
  }).returning();
  await processTradeForAlphaSignal(trade2.id, wallet2.id, mockMarket.id, 0, 0.60, new Date());

  // Wait simulating time
  // Wallet 2 buys at $0.45 (Difference to Wallet 1 is $0.05 -> SHOULD TRIGGER)
  console.log('[Test] Wallet 2 buys again at $0.45 (Price diff <= $0.10, SHOULD TRIGGER SIGNAL)');
  const [trade3] = await db.insert(trades).values({
    walletId: wallet2.id, marketId: mockMarket.id, outcomeIndex: 0, action: 'BUY', price: 0.45, shares: 100
  }).returning();
  await processTradeForAlphaSignal(trade3.id, wallet2.id, mockMarket.id, 0, 0.45, new Date());

  console.log('[Test] Phase 3 Complete.');
  process.exit(0);
}

verifyEngine().catch(console.error);
