"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeWebSocket = closeWebSocket;
exports.connectWebSocket = connectWebSocket;
exports.subscribeToMarket = subscribeToMarket;
const api_1 = require("./api");
const ws_1 = __importDefault(require("ws"));
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const filterService_1 = require("./filterService");
let ws = null;
const SUBSCRIBED_MARKETS = new Set();
let heartbeatTimeout = null;
let pingInterval;
const heartbeat = () => {
    if (heartbeatTimeout)
        clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
        console.warn('[WS] Heartbeat timeout. Terminating connection...');
        ws?.terminate();
    }, 35000);
};
function closeWebSocket() {
    if (heartbeatTimeout)
        clearTimeout(heartbeatTimeout);
    if (pingInterval)
        clearInterval(pingInterval);
    if (ws) {
        console.log('[WS] Gracefully terminating WebSocket connection...');
        ws.terminate();
        ws = null;
    }
}
function connectWebSocket() {
    console.log('[WS] Connecting to Polymarket CLOB...');
    ws = new ws_1.default(api_1.CLOB_WS_URL);
    ws.on('open', () => {
        console.log('[WS] Connected successfully.');
        heartbeat();
        pingInterval = setInterval(() => {
            if (ws?.readyState === ws_1.default.OPEN)
                ws.ping();
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
        }
        catch (e) {
            console.warn('[WS] Received non-JSON message:', data.toString());
            return;
        }
        try {
            // Polymarket CLOB returns trade events
            if (message.event === 'trade') {
                await handleLiveTrade(message.data);
            }
        }
        catch (e) {
            console.error('[WS] Error handling message:', e);
        }
    });
    ws.on('close', () => {
        if (heartbeatTimeout)
            clearTimeout(heartbeatTimeout);
        if (pingInterval)
            clearInterval(pingInterval);
        console.log('[WS] Connection closed. Reconnecting in 5s...');
        setTimeout(connectWebSocket, 5000);
    });
    ws.on('error', (err) => {
        console.error('[WS] Error:', err);
    });
}
async function subscribeToMarket(marketId) {
    if (!ws || ws.readyState !== ws_1.default.OPEN)
        return;
    if (!SUBSCRIBED_MARKETS.has(marketId)) {
        const market = await db_1.db.select().from(schema_1.markets).where((0, drizzle_orm_1.eq)(schema_1.markets.conditionId, marketId)).get();
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
async function handleLiveTrade(tradeData) {
    // Pass to noise filter first
    const isValid = await (0, filterService_1.processTradeForFilter)(tradeData);
    if (!isValid)
        return;
    // Insert Wallet (Taker)
    const walletAddress = tradeData.taker?.toLowerCase();
    let wallet = await db_1.db.select().from(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.address, walletAddress)).get();
    if (!wallet) {
        [wallet] = await db_1.db.insert(schema_1.wallets).values({
            address: walletAddress,
        }).returning();
    }
    // Find Market
    const market = await db_1.db.select().from(schema_1.markets).where((0, drizzle_orm_1.eq)(schema_1.markets.conditionId, tradeData.market)).get();
    if (!market) {
        console.warn(`[WS] Trade for unknown market ${tradeData.market}. Skipping DB insert.`);
        return;
    }
    // Insert Trade
    const tokenIds = JSON.parse(market.clobTokenIds || '[]');
    await db_1.db.insert(schema_1.trades).values({
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
