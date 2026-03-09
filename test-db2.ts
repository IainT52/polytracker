import { db } from './src/db';
import { trades, markets } from './src/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

async function run() {
  const cachedIngestionStats = await db.select({
      marketId: markets.conditionId,
      question: markets.question,
      tradeCount: sql<number>`COUNT(${trades.id})`.mapWith(Number)
    })
      .from(trades)
      .leftJoin(markets, eq(trades.marketId, markets.id))
      .groupBy(trades.marketId)
      .orderBy(desc(sql`COUNT(${trades.id})`))
      .all();
      
  console.log("Stats length:", cachedIngestionStats.length);
  console.log("Total trades summed:", cachedIngestionStats.reduce((acc, curr) => acc + curr.tradeCount, 0));
  console.log(cachedIngestionStats.slice(0, 5));
}
run();
