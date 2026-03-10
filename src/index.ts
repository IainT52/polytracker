import { bot } from './bot/telegramBot';
import { connectWebSocket } from './services/realtimeListener';
import { scrapeHistoricalData } from './services/historicalScraper';
import { startApiServer } from './api/server';
import { runWalletGrader } from './engine/grader';
import { mapSyndicates } from './engine/syndicateMapper';
import { setupDbSync } from './db';

async function bootstrap() {
  console.log('🚀 Starting PolyTracker...');
  
  console.log('⚙️ Initializing SQLite Database thread pools...');
  await setupDbSync();

  // Run the historical data scraper async so it doesn't block the API/WS
  console.log('\n--- Phase 2: Running Historical Scraper Async ---');
  scrapeHistoricalData().catch(console.error);

  // 1. Start the Dashboard API Server
  console.log('\n--- Phase 6: Starting Dashboard API ---');
  startApiServer(process.env.PORT ? parseInt(process.env.PORT) : 4000);

  // 2. Start the realtime WebSocket listener
  console.log('\n--- Phase 2: Starting Realtime Listener ---');
  connectWebSocket();

  // 3. Start the Telegram Bot
  console.log('\n--- Phase 4/5: Starting Telegram Bot Interface ---');
  if (process.env.TELEGRAM_BOT_TOKEN) {
    bot.launch();
    console.log('🤖 Telegram Bot is running! Use /start to begin.');
  } else {
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
        await runWalletGrader();
        await mapSyndicates(); // Use the correct imported function here
      } catch (e) {
        console.error('[Analytics] Error during execution:', e);
      } finally {
        runCount++;
        scheduleAnalytics(); // Recursively schedule the next run
      }
    }, nextWaitMs);
  };

  // Start the scheduler
  scheduleAnalytics();
  // Phase 15: Structural Graceful Shutdown Framework
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Initiating Global Shutdown Sequence...`);

    // 1. Stop Telegram Interface
    if (process.env.TELEGRAM_BOT_TOKEN) bot.stop(signal);

    // 2. Safely close WebSocket connections
    const { closeWebSocket } = await import('./services/realtimeListener');
    closeWebSocket();

    // 3. Signal the polling Scraper to break chunks and stop loops
    const { signalScraperShutdown } = await import('./services/historicalScraper');
    signalScraperShutdown();

    // 4. Wait for any active Drizzle asynchronous Promise.allSettled chunks to resolve globally
    console.log('⏳ Waiting 3 seconds for active executing batch inserts to finish...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. Explicitly disconnect the Drizzle client SQLite pool connection
    console.log('🔌 Shutting down Native Database Pool...');
    try {
      const { client } = await import('./db/index');
      client.close();
    } catch (err) {
      console.warn('⚠️ Non-fatal error while closing DB pool:', err);
    }

    console.log('✅ Graceful Shutdown Complete. Have a nice day.');
    process.exit(0);
  };

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

bootstrap().catch(console.error);
