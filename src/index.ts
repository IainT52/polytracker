import { bot } from './bot/telegramBot';
import { connectWebSocket } from './services/realtimeListener';
import { scrapeHistoricalData } from './services/historicalScraper';
import { startApiServer } from './api/server';

async function bootstrap() {
  console.log('🚀 Starting PolyTracker...');

  // Run the historical data scraper async so it doesn't block the API/WS
  console.log('\n--- Phase 2: Running Historical Scraper Async ---');
  scrapeHistoricalData().catch(console.error);

  // 1. Start the Dashboard API Server
  console.log('\n--- Phase 6: Starting Dashboard API ---');
  startApiServer(3001);

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



  // Handle graceful shutdown
  process.once('SIGINT', () => {
    console.log('Stopping...');
    if (process.env.TELEGRAM_BOT_TOKEN) bot.stop('SIGINT');
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    console.log('Stopping...');
    if (process.env.TELEGRAM_BOT_TOKEN) bot.stop('SIGTERM');
    process.exit(0);
  });
}

bootstrap().catch(console.error);
