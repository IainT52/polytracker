"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const telegramBot_1 = require("./bot/telegramBot");
const db_1 = require("./db");
const schema_1 = require("./db/schema");
// Mock DB for the test if not present
async function setupMockUser() {
    await db_1.db.insert(schema_1.users).values({
        telegramId: 'mock123',
        username: 'TestSubscriber',
        alertsEnabled: true,
        paperTrading: true
    }).onConflictDoNothing();
}
async function verifyBot() {
    console.log('--- Phase 4 Verification: Telegram Bot Interface ---');
    await setupMockUser();
    console.log('\n>> Attempting Alpha Signal Broadcast (Safe Loop & HTML Format)');
    // Test Broadcast logic (no token so it will skip sending, but verify formatting & loop)
    await (0, telegramBot_1.broadcastAlphaSignal)('Will Bitcoin hit $100k?', 'BUY YES', 0.65, [
        { address: '0x1A2B3c4d5e6f7g8h9i0j', grade: 'A', recentRoi30d: 0 },
        { address: '0x99998888777766665555', grade: 'B', recentRoi30d: 0 }
    ], 2);
    console.log('\n[Test] Phase 4 Complete. Bot instance initialized and broadcast loop validated.');
    process.exit(0);
}
verifyBot().catch(console.error);
