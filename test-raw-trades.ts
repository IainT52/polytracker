import { fetchWithRetry } from './src/services/api';
async function run() { 
  const url = `https://data-api.polymarket.com/trades?market=0x27f551b9d4e512419ec468eb37ed91008cbffeaece4793f77df23351ecf839fc&limit=2&offset=0`;
  const trades = await fetchWithRetry(url);
  console.log(JSON.stringify(trades, null, 2));
}
run();
