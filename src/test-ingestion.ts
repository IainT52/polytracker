import { scrapeHistoricalData } from './services/historicalScraper';
import { connectWebSocket, subscribeToMarket } from './services/realtimeListener';
import { db } from './db';
import { markets } from './db/schema';

async function verifyDataIngestion() {
  console.log('--- Phase 2 Verification ---');

  // 1. Test Historical Scraper & Rate Limits
  console.log('\n>> Testing Historical Scraper');
  await scrapeHistoricalData();

  // 2. Test Real-time WebSocket Logic
  console.log('\n>> Testing WebSocket Real-time Listener');
  connectWebSocket();

  // Wait 2 seconds for WS to connect, then subscribe to saved markets
  setTimeout(async () => {
    const savedMarkets = await db.select().from(markets).limit(3).all();
    if (savedMarkets.length > 0) {
      console.log(`\n[Test] Subscribing to ${savedMarkets.length} active markets...`);
      for (const m of savedMarkets) {
        subscribeToMarket(m.conditionId);
      }
    } else {
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
