import { CLOB_WS_URL } from './api';
import WebSocket from 'ws';
import { db } from '../db';
import { trades, wallets, markets } from '../db/schema';
import { eq } from 'drizzle-orm';
import { processTradeForFilter } from './filterService';

let ws: WebSocket | null = null;
const SUBSCRIBED_MARKETS = new Set<string>();

export function connectWebSocket() {
  console.log('[WS] Connecting to Polymarket CLOB...');
  ws = new WebSocket(CLOB_WS_URL);

  ws.on('open', () => {
    console.log('[WS] Connected successfully.');
    // We will dynamically subscribe to markets here as we discover them
  });

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Polymarket CLOB returns trade events
      if (message.event === 'trade') {
        await handleLiveTrade(message.data);
      }
    } catch (e) {
      console.error('[WS] Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Connection closed. Reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
}

export function subscribeToMarket(marketId: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (!SUBSCRIBED_MARKETS.has(marketId)) {
    ws.send(JSON.stringify({
      action: "subscribe",
      channel: "trades",
      market: marketId
    }));
    SUBSCRIBED_MARKETS.add(marketId);
  }
}

async function handleLiveTrade(tradeData: any) {
  // Pass to noise filter first
  const isValid = await processTradeForFilter(tradeData);
  if (!isValid) return;

  // Insert Wallet (Taker)
  const walletAddress = tradeData.taker?.toLowerCase();
  let wallet = await db.select().from(wallets).where(eq(wallets.address, walletAddress)).get();

  if (!wallet) {
    [wallet] = await db.insert(wallets).values({
      address: walletAddress,
    }).returning();
  }

  // Find Market
  const market = await db.select().from(markets).where(eq(markets.conditionId, tradeData.market)).get();
  if (!market) {
    console.warn(`[WS] Trade for unknown market ${tradeData.market}. Skipping DB insert.`);
    return;
  }

  // Insert Trade
  await db.insert(trades).values({
    walletId: wallet.id,
    marketId: market.id,
    outcomeIndex: tradeData.side === 'BUY' ? 0 : 1, // Simplified assumption
    action: tradeData.side,
    price: parseFloat(tradeData.price),
    shares: parseFloat(tradeData.size),
    transactionHash: tradeData.transaction_hash || tradeData.id,
    timestamp: new Date(parseInt(tradeData.timestamp) * 1000), // Assuming seconds
  });

  console.log(`[WS] Processed Live Trade: ${walletAddress} ${tradeData.side} ${tradeData.size} shares on ${tradeData.market}`);
}
