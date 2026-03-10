"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const db_schema = __importStar(require("./db/schema"));
const schema_1 = require("./db/schema");
const grader_1 = require("./engine/grader");
const historicalScraper_1 = require("./services/historicalScraper");
const drizzle_orm_1 = require("drizzle-orm");
// Mock the global fetch to test the Rate Limiter and Pagination parsing
const originalFetch = global.fetch;
async function setupMocks() {
    global.fetch = async (input, init) => {
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
            }
            else if (url.includes('cursor=page2_token')) {
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
    await db_1.db.delete(db_schema.paperPositions);
    await db_1.db.delete(db_schema.userPositions);
    await db_1.db.delete(schema_1.trades);
    await db_1.db.delete(schema_1.markets);
    await db_1.db.delete(schema_1.wallets);
    // 3. Test the Scraper Deep History flow using the mocks
    console.log('Running Deep History Scraper with Mocks...');
    await setupMocks();
    await (0, historicalScraper_1.scrapeHistoricalData)();
    // Restore Fetch
    global.fetch = originalFetch;
    // 4. Run the CTE
    await (0, grader_1.runWalletGrader)();
    // Verify Results
    const updatedWallet = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.address, '0xw1')).get();
    if (updatedWallet) {
        // 100 shares at $0.50 = Spend $50
        // 100 shares at $0.60 = Earn $60
        // Net = +$10. Volume = $110. ROI = 10 / 110 = 9.09%
        console.log(`Expected ROI: 9.09%. Actual ROI: ${updatedWallet.roi?.toFixed(2)}%`);
        console.log(`Expected WinRate: 100%. Actual WinRate: ${updatedWallet.winRate?.toFixed(2)}%`);
        if (updatedWallet.roi && Math.abs(updatedWallet.roi - 9.09) < 0.1) {
            console.log('✅ Ingestion & SQL CTE logic is working properly!');
        }
        else {
            console.error('❌ SQL CTE Logic failed.');
        }
    }
    else {
        console.error('❌ No wallets ingested from mocks!');
    }
}
async function runTests() {
    await testSQLNativeGrader();
    process.exit(0);
}
runTests();
