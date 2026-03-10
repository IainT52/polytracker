import { db } from './src/db/index';
import { markets } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function run() {
  const m = await db.select().from(markets).limit(5).all();
  for (const marketMeta of m) {
    let favoredOutcomeName = `Outcome 0`;
    try {
      const parsedOutcomes = JSON.parse(marketMeta.outcomes || '[]');
      if (parsedOutcomes[0]) {
        favoredOutcomeName = parsedOutcomes[0];
      }
    } catch (e) {
      console.log("Error:", e);
    }
    console.log(JSON.stringify({ marketId: marketMeta.conditionId, favoredOutcomeName }));
  }
}
run();
