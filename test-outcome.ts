import { db } from './src/db/index';
import { trades, wallets, markets } from './src/db/schema';
import { fetchMarketTrades, fetchActiveMarkets } from './src/services/api';

async function test() {
   const m = await fetchActiveMarkets();
   const market = m.find(x => JSON.parse(x.clobTokenIds || '[]').length > 1);
   if (!market) return console.log("No markets found");

   console.log("Token IDs from Gamma:", market.clobTokenIds);
   
   const t = await fetchMarketTrades(market.conditionId, 5);
   if (t.length > 0) {
       console.log("Trade asset_id:", t[0].asset_id);
       const tokenIds = JSON.parse(market.clobTokenIds || '[]');
       
       console.log("Strict indexOf:", tokenIds.indexOf(t[0].asset_id));
       console.log("Lowercased index:", tokenIds.findIndex((id: string) => id.toLowerCase() === t[0].asset_id?.toLowerCase()));
   }
}
test().catch(console.error);
