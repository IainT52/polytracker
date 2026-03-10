import { db } from './src/db/index';
import { markets } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function run() {
  const m = await db.select().from(markets).limit(5).all();
  console.log("Outcomes from sqlite:");
  for (const market of m) {
     console.log(typeof market.outcomes, market.outcomes);
     try {
       const parsed = JSON.parse(market.outcomes || '[]');
       console.log("Parsed:", parsed);
     } catch (e) {
       console.log("Failed to parse:", e.message);
     }
  }
}
run();
