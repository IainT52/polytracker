"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const positionManager_1 = require("./services/positionManager");
const drizzle_orm_1 = require("drizzle-orm");
async function runTest() {
    console.log('--- Setting up DB Mock Data ---');
    // Insert Mock User & Config
    const [user] = await db_1.db.insert(schema_1.users).values({
        telegramId: `bot-tp-tester-${Date.now()}`
    }).returning();
    await db_1.db.insert(schema_1.autoTradeConfigs).values({
        userId: user.id,
        takeProfitPct: 50, // Set TP to +50%
        stopLossPct: 20
    });
    // Insert Mock Market
    const [market] = await db_1.db.insert(schema_1.markets).values({
        conditionId: `0xTPTestCond${Date.now()}`,
        question: 'Will this hit Take Profit?',
        outcomes: '["Yes", "No"]'
    }).returning();
    // Insert mock PAPER_OPEN position bought at $0.40
    const [position] = await db_1.db.insert(schema_1.paperPositions).values({
        userId: user.id,
        marketId: market.id,
        outcomeIndex: 0,
        buyPrice: 0.40,
        shares: 100, // Total Cost = $40
        totalCost: 40,
        status: 'PAPER_OPEN'
    }).returning();
    console.log(`Created PAPER_OPEN Position ${position.id} @ $0.40`);
    // Mock global.fetch to intercept fetchWithRetry
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
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
    await (0, positionManager_1.managePositions)();
    // Restore fetch
    global.fetch = originalFetch;
    // Verify
    const updatedPos = await db_1.db.select().from(schema_1.paperPositions).where((0, drizzle_orm_1.eq)(schema_1.paperPositions.id, position.id)).get();
    console.log('--- Results ---');
    console.log(`Original Status: PAPER_OPEN`);
    console.log(`New Status: ${updatedPos?.status}`);
    console.log(`Resolved Price: ${updatedPos?.resolvedPrice}`);
    console.log(`Realized PnL: ${updatedPos?.realizedPnL}`);
    if (updatedPos?.status === 'SOLD_TP' && Math.abs((updatedPos?.realizedPnL || 0) - 20.00) < 0.01) {
        console.log('✅ TEST PASSED: Successfully identified +50% gain, simulated TP, and updated DB.');
    }
    else {
        console.log('❌ TEST FAILED');
    }
    process.exit(0);
}
runTest().catch(console.error);
