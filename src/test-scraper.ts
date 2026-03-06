import { scrapeHistoricalData } from './services/historicalScraper';
import { db } from './db';
import { wallets, trades, markets } from './db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log("Starting scrape...");
  await scrapeHistoricalData();
  
  console.log("Scrape finished! Checking DB...");
  const w = await db.select({ count: sql<number>`count(*)` }).from(wallets).get();
  const t = await db.select({ count: sql<number>`count(*)` }).from(trades).get();
  const m = await db.select({ count: sql<number>`count(*)` }).from(markets).get();
  
  console.log(`DB Count -> Markets: ${m?.count}, Wallets: ${w?.count}, Trades: ${t?.count}`);
  process.exit(0);
}

main().catch(console.error);
