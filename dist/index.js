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
const telegramBot_1 = require("./bot/telegramBot");
const realtimeListener_1 = require("./services/realtimeListener");
const historicalScraper_1 = require("./services/historicalScraper");
const server_1 = require("./api/server");
const grader_1 = require("./engine/grader");
const syndicateMapper_1 = require("./engine/syndicateMapper");
async function bootstrap() {
    console.log('🚀 Starting PolyTracker...');
    // Run the historical data scraper async so it doesn't block the API/WS
    console.log('\n--- Phase 2: Running Historical Scraper Async ---');
    (0, historicalScraper_1.scrapeHistoricalData)().catch(console.error);
    // 1. Start the Dashboard API Server
    console.log('\n--- Phase 6: Starting Dashboard API ---');
    (0, server_1.startApiServer)(3001);
    // 2. Start the realtime WebSocket listener
    console.log('\n--- Phase 2: Starting Realtime Listener ---');
    (0, realtimeListener_1.connectWebSocket)();
    // 3. Start the Telegram Bot
    console.log('\n--- Phase 4/5: Starting Telegram Bot Interface ---');
    if (process.env.TELEGRAM_BOT_TOKEN) {
        telegramBot_1.bot.launch();
        console.log('🤖 Telegram Bot is running! Use /start to begin.');
    }
    else {
        console.warn('⚠️ No TELEGRAM_BOT_TOKEN provided. Bot is offline.');
    }
    // Schedule (in minutes): 5 cycles of 1 min, three 2s, one 5, then capped at 10 forever
    const backoffScheduleMins = [1, 1, 1, 1, 1, 2, 2, 2, 5];
    let runCount = 0;
    const scheduleAnalytics = () => {
        // Determine wait time: use the array, or default to 10 minutes if we've exhausted the array
        const nextWaitMins = runCount < backoffScheduleMins.length ? backoffScheduleMins[runCount] : 10;
        const nextWaitMs = nextWaitMins * 60 * 1000;
        setTimeout(async () => {
            console.log(`\n--- 🧠 Running Scheduled Analytical Engines (Run #${runCount + 1}) ---`);
            try {
                await (0, grader_1.runWalletGrader)();
                await (0, syndicateMapper_1.mapSyndicates)(); // Use the correct imported function here
            }
            catch (e) {
                console.error('[Analytics] Error during execution:', e);
            }
            finally {
                runCount++;
                scheduleAnalytics(); // Recursively schedule the next run
            }
        }, nextWaitMs);
    };
    // Start the scheduler
    scheduleAnalytics();
    // Phase 15: Structural Graceful Shutdown Framework
    const gracefulShutdown = async (signal) => {
        console.log(`\n🛑 Received ${signal}. Initiating Global Shutdown Sequence...`);
        // 1. Stop Telegram Interface
        if (process.env.TELEGRAM_BOT_TOKEN)
            telegramBot_1.bot.stop(signal);
        // 2. Safely close WebSocket connections
        const { closeWebSocket } = await Promise.resolve().then(() => __importStar(require('./services/realtimeListener')));
        closeWebSocket();
        // 3. Signal the polling Scraper to break chunks and stop loops
        const { signalScraperShutdown } = await Promise.resolve().then(() => __importStar(require('./services/historicalScraper')));
        signalScraperShutdown();
        // 4. Wait for any active Drizzle asynchronous Promise.allSettled chunks to resolve globally
        console.log('⏳ Waiting 3 seconds for active executing batch inserts to finish...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        // 5. Explicitly disconnect the Drizzle client SQLite pool connection
        console.log('🔌 Shutting down Native Database Pool...');
        try {
            const { client } = await Promise.resolve().then(() => __importStar(require('./db/index')));
            client.close();
        }
        catch (err) {
            console.warn('⚠️ Non-fatal error while closing DB pool:', err);
        }
        console.log('✅ Graceful Shutdown Complete. Have a nice day.');
        process.exit(0);
    };
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
bootstrap().catch(console.error);
