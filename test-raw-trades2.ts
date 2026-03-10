import { db } from './src/db/index';
import { markets } from './src/db/schema';
import { fetchWithRetry } from './src/services/api';
import { desc, eq } from 'drizzle-orm';

async function run() { 
  const topMarket = await db.select().from(markets).where(eq(markets.resolved, false)).orderBy(desc(markets.volume)).limit(1).get();
  if (!topMarket) return console.log("No active markets");

  console.log(`Top Market: ${topMarket.conditionId} (${topMarket.question})`);
  const url = `https://data-api.polymarket.com/trades?market=${topMarket.conditionId}&limit=5&offset=0`;
  const trades = await fetchWithRetry(url);
  console.log(JSON.stringify(trades, null, 2));
}
run();
