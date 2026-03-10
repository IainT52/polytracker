"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const historicalScraper_1 = require("./services/historicalScraper");
const realtimeListener_1 = require("./services/realtimeListener");
const db_1 = require("./db");
const schema_1 = require("./db/schema");
async function verifyDataIngestion() {
    console.log('--- Phase 2 Verification ---');
    // 1. Test Historical Scraper & Rate Limits
    console.log('\n>> Testing Historical Scraper');
    await (0, historicalScraper_1.scrapeHistoricalData)();
    // 2. Test Real-time WebSocket Logic
    console.log('\n>> Testing WebSocket Real-time Listener');
    (0, realtimeListener_1.connectWebSocket)();
    // Wait 2 seconds for WS to connect, then subscribe to saved markets
    setTimeout(async () => {
        const savedMarkets = await db_1.db.select().from(schema_1.markets).limit(3).all();
        if (savedMarkets.length > 0) {
            console.log(`\n[Test] Subscribing to ${savedMarkets.length} active markets...`);
            for (const m of savedMarkets) {
                (0, realtimeListener_1.subscribeToMarket)(m.conditionId);
            }
        }
        else {
            console.log('\n[Test] No markets found to subscribe to.');
        }
        // Close the process after 15 seconds to finish the test gracefully
        setTimeout(() => {
            console.log('\n[Test] Data Ingestion Verification Complete. Exiting...');
            process.exit(0);
        }, 15000);
    }, 2000);
}
verifyDataIngestion().catch(console.error);
