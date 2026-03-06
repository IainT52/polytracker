import { db } from './src/db';
import { executeAutoTrades } from './src/services/tradeExecutor';

async function testDynamicSizing() {
  console.log('Testing Phase 11 Dynamic Conviction Sizing...');

  // Market: 12345, Outcome: 0 (YES), Alpha Price: $0.45
  // We simulate a Net Conviction score of 5 for this alpha cluster.
  const marketId = 12345;
  const outcomeIndex = 0;
  const price = 0.45;
  const netConviction = 5;

  console.log(`Simulating Alpha Signal Broadcast with Net Conviction = ${netConviction}`);

  try {
    await executeAutoTrades(marketId, outcomeIndex, price, netConviction);
    console.log('Test complete. Check the logs above for Dynamic Sizing application.');
  } catch (e) {
    console.error('Error in test:', e);
  }
}

testDynamicSizing();
