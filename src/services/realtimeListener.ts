import { CLOB_WS_URL } from './api';
import WebSocket from 'ws';
import { db } from '../db';
import { trades, wallets, markets } from '../db/schema';
import { eq } from 'drizzle-orm';
import { processTradeForFilter } from './filterService';

let ws: WebSocket | null = null;
const SUBSCRIBED_MARKETS = new Set<string>();

let heartbeatTimeout: NodeJS.Timeout | null = null;
let pingInterval: NodeJS.Timeout;

const heartbeat = () => {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  heartbeatTimeout = setTimeout(() => {
    console.warn('[WS] Heartbeat timeout. Terminating connection...');
    ws?.terminate();
  }, 35000);
};

export function closeWebSocket() {
  if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
  if (pingInterval) clearInterval(pingInterval);
  if (ws) {
    console.log('[WS] Gracefully terminating WebSocket connection...');
    ws.terminate();
    ws = null;
  }
}

export function connectWebSocket() {
  console.log('[WS] Connecting to Polymarket CLOB...');
  ws = new WebSocket(CLOB_WS_URL);

  ws.on('open', () => {
    console.log('[WS] Connected successfully.');
    heartbeat();
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);

    // Re-subscribe to known markets on reconnect
    const marketsToResubscribe = Array.from(SUBSCRIBED_MARKETS);
    SUBSCRIBED_MARKETS.clear(); // Clear so the function actually sends the message
    marketsToResubscribe.forEach(m => subscribeToMarket(m));
  });

  ws.on('ping', heartbeat);
  ws.on('pong', heartbeat);

  ws.on('message', async (data) => {
    heartbeat();
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      console.warn('[WS] Received non-JSON message:', data.toString());
      return;
    }

    try {
      // Polymarket CLOB returns trade events
      if (message.event === 'trade') {
        await handleLiveTrade(message.data);
      }
    } catch (e) {
      console.error('[WS] Error handling message:', e);
    }
  });

  ws.on('close', () => {
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    if (pingInterval) clearInterval(pingInterval);
    console.log('[WS] Connection closed. Reconnecting in 5s...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err);
  });
}

export async function subscribeToMarket(marketId: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  if (!SUBSCRIBED_MARKETS.has(marketId)) {
    const market = await db.select().from(markets).where(eq(markets.conditionId, marketId)).get();
    if (market) {
      const tokenIds = JSON.parse(market.clobTokenIds || '[]');
      if (Array.isArray(tokenIds) && tokenIds.length > 0) {
        ws.send(JSON.stringify({
          assets_ids: tokenIds,
          operation: "subscribe"
        }));
        SUBSCRIBED_MARKETS.add(marketId);
      }
    }
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
  const tokenIds = JSON.parse(market.clobTokenIds || '[]');

  await db.insert(trades).values({
    walletId: wallet.id,
    marketId: market.id,
    outcomeIndex: tokenIds.indexOf(tradeData.asset_id) !== -1 ? tokenIds.indexOf(tradeData.asset_id) : 0, 
    action: tradeData.side,
    price: parseFloat(tradeData.price),
    shares: parseFloat(tradeData.size),
    transactionHash: tradeData.transaction_hash || tradeData.id,
    timestamp: new Date(parseInt(tradeData.timestamp) * 1000), // Assuming seconds
  });

  console.log(`[WS] Processed Live Trade: ${walletAddress} ${tradeData.side} ${tradeData.size} shares on ${tradeData.market}`);
}
