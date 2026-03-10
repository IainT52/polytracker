import { db, setupDbSync } from '../db';
import { markets } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMarkets(limit: number, offset: number) {
  // Use closed=true and volume_num_min=10000 (fallback check added later)
  const url = `${GAMMA_API_URL}/markets?closed=true&volume_num_min=10000&limit=${limit}&offset=${offset}&order=volume&ascending=false`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json() || [];
  } catch (error: any) {
    console.error(`[Discovery] API Fetch error at offset ${offset}:`, error.message);
    return [];
  }
}

async function discoverMarkets(maxDiscoveryLimit: number) {
  console.log(`[Discovery] Starting Historical Market Discovery (Max Target: ${maxDiscoveryLimit})...`);
  
  let offset = 0;
  const BATCH_SIZE = 100;
  let totalFetched = 0;
  let totalSaved = 0;
  let totalFiltered = 0;

  while (totalFetched < maxDiscoveryLimit) {
    const batchLimit = Math.min(BATCH_SIZE, maxDiscoveryLimit - totalFetched);
    console.log(`[Discovery] Fetching batch: offset ${offset}, limit ${batchLimit}...`);
    
    const rawMarkets = await fetchMarkets(batchLimit, offset);
    if (!rawMarkets || rawMarkets.length === 0) {
      console.log('[Discovery] No more markets returned from API. Ending discovery.');
      break;
    }

    totalFetched += rawMarkets.length;
    const marketsToSave: any[] = [];

    for (const m of rawMarkets) {
      // 1. Fallback Volume Check
      const volume = parseFloat(m.volume || '0');
      if (volume < 10000) {
        totalFiltered++;
        continue;
      }

      // 2. Cancelled Market Filter & Resolution Index Calculation
      let outcomePrices: number[] = [];
      try {
        outcomePrices = JSON.parse(m.outcomePrices || '[]').map((p: string) => parseFloat(p));
      } catch (e) {
        totalFiltered++;
        continue;
      }

      const maxPrice = Math.max(...outcomePrices);
      
      // Constraint: Must be >= 0.9 for ML purity (ignores cancelled/invalid)
      if (maxPrice < 0.9) {
        totalFiltered++;
        continue;
      }

      const resolvedIndex = outcomePrices.indexOf(maxPrice);

      // 3. Map to Schema
      marketsToSave.push({
        id: m.id,
        conditionId: m.conditionId,
        question: m.question,
        slug: m.slug || '',
        description: m.description || '',
        outcomes: m.outcomes || '[]',
        clobTokenIds: m.clobTokenIds || JSON.stringify(m.tokens?.map((t: any) => t.token_id) || []),
        category: m.category || 'Uncategorized',
        tags: m.tags || '[]',
        volume: volume,
        endDate: m.endDate || '',
        icon: m.icon || '',
        active: false,
        closed: true,
        resolved: true,
        resolvedOutcomeIndex: resolvedIndex
      });
    }

    if (marketsToSave.length > 0) {
      try {
        await db.insert(markets)
          .values(marketsToSave)
          .onConflictDoNothing()
          .run();
        totalSaved += marketsToSave.length;
        console.log(`[Discovery] Saved ${marketsToSave.length} markets. (Total Saved: ${totalSaved}, Total Filtered: ${totalFiltered})`);
      } catch (error: any) {
        console.error('[Discovery] Database insert error:', error.message);
      }
    }

    offset += rawMarkets.length;

    // Safety: API Rate Limiting (1000ms delay as requested)
    console.log('[Discovery] ⏳ Waiting 1000ms for rate limit safety...');
    await wait(1000);
  }

  console.log('--- Discovery Results ---');
  console.log(`Total Markets Fetched from API: ${totalFetched}`);
  console.log(`Total Markets Filtered (Volume/Price): ${totalFiltered}`);
  console.log(`Total Markets Successfully Saved to SQLite: ${totalSaved}`);
}

// Standalone execution block
if (require.main === module) {
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limitValue = limitArg ? parseInt(limitArg.split('=')[1]) : 1000;

  setupDbSync().then(() => {
    discoverMarkets(limitValue)
      .then(() => {
        console.log('[Discovery] Done.');
        process.exit(0);
      })
      .catch((err) => {
        console.error('[Discovery] Fatal error:', err);
        process.exit(1);
      });
  }).catch(err => {
    console.error('[Discovery] Failed to initialize DB sync:', err);
    process.exit(1);
  });
}
