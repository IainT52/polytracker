import { db } from './db';
import * as db_schema from './db/schema';
import { wallets, markets, trades } from './db/schema';
import { runWalletGrader } from './engine/grader';
import { fetchActiveMarkets, fetchMarketTrades } from './services/api';
import { scrapeHistoricalData } from './services/historicalScraper';
import { eq } from 'drizzle-orm';

// Mock the global fetch to test the Rate Limiter and Pagination parsing
const originalFetch = global.fetch;

async function setupMocks() {
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input.toString();

    // 1. Mock Gamma API (Active Markets)
    if (url.includes('gamma-api.polymarket.com/events')) {
      return new Response(JSON.stringify([{
        markets: [
          {
            id: 'mock-id-1',
            conditionId: '0xMockCondition1',
            question: 'Will there be a mock market?',
            description: 'Mock',
            outcomes: '["Yes", "No"]',
            active: true,
            closed: false
          }
        ]
      }]), { status: 200 });
    }

    // 2. Mock Data API (Trades Pagination)
    if (url.includes('data-api.polymarket.com/trades')) {
      // Simulate Cursor Pagination Pages
      if (!url.includes('cursor=')) {
        // Page 1
        return new Response(JSON.stringify({
          data: [
            { transactionHash: '0xh1', proxyWallet: '0xW1', price: '0.50', size: '100', side: 'BUY', timestamp: '1700000000' }
          ],
          next_cursor: 'page2_token'
        }), { status: 200 });
      } else if (url.includes('cursor=page2_token')) {
        // Page 2
        return new Response(JSON.stringify({
          data: [
            { transactionHash: '0xh2', proxyWallet: '0xW1', price: '0.60', size: '100', side: 'SELL', timestamp: '1700000050' }
          ],
          next_cursor: 'LTE=' // Standard PM ending cursor
        }), { status: 200 });
      }
    }

    return new Response(JSON.stringify({}), { status: 404 });
  };
}


async function testSQLNativeGrader() {
  console.log('--- Testing Phase 10 SQL CTE ---');

  // Clear relevant DB tables for test
  await db.delete(db_schema.paperPositions);
  await db.delete(db_schema.userPositions);
  await db.delete(trades);
  await db.delete(markets);
  await db.delete(wallets);

  // 3. Test the Scraper Deep History flow using the mocks
  console.log('Running Deep History Scraper with Mocks...');
  await setupMocks();
  await scrapeHistoricalData();

  // Restore Fetch
  global.fetch = originalFetch;

  // 4. Run the CTE
  await runWalletGrader();

  // Verify Results
  const updatedWallet = await db.select().from(wallets).where(eq(wallets.address, '0xw1')).get();

  if (updatedWallet) {
    // 100 shares at $0.50 = Spend $50
    // 100 shares at $0.60 = Earn $60
    // Net = +$10. Volume = $110. ROI = 10 / 110 = 9.09%
    console.log(`Expected ROI: 9.09%. Actual ROI: ${updatedWallet.roi?.toFixed(2)}%`);
    console.log(`Expected WinRate: 100%. Actual WinRate: ${updatedWallet.winRate?.toFixed(2)}%`);

    if (updatedWallet.roi && Math.abs(updatedWallet.roi - 9.09) < 0.1) {
      console.log('✅ Ingestion & SQL CTE logic is working properly!');
    } else {
      console.error('❌ SQL CTE Logic failed.');
    }
  } else {
    console.error('❌ No wallets ingested from mocks!');
  }
}

async function runTests() {
  await testSQLNativeGrader();
  process.exit(0);
}

runTests();
