import { fetchMarketTrades } from './src/services/api';
async function run() { 
  const trades = await fetchMarketTrades('0x27f551b9d4e512419ec468eb37ed91008cbffeaece4793f77df23351ecf839fc', 2);
  console.log(JSON.stringify(trades, null, 2));
}
run();
