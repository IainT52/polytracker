"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startLiveStream = startLiveStream;
exports.stopLiveStream = stopLiveStream;
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const filterService_1 = require("./filterService");
// Phase 15: Scaffolded Real-Time WebSocket Engine
// Uses native WebSocket API (Node 18+) as ws NPM package is restricted.
const RPC_ENDPOINT = process.env.RPC_WSS_ENDPOINT || 'wss://example-rpc-provider.com/ws';
let ws = null;
let reconnectTimer = null;
async function startLiveStream() {
    console.log('[LiveStream] Initializing real-time RPC WebSocket connection...');
    try {
        // 1. Fetch exactly which wallets we care about (from Grade A/B or all discovered)
        const allWallets = await db_1.db.select({ address: schema_1.wallets.address }).from(schema_1.wallets).all();
        const trackedAddresses = allWallets.map(w => w.address);
        console.log(`[LiveStream] Subscribing to ${trackedAddresses.length} wallet addresses on-chain.`);
        // 2. Open Native WebSocket
        ws = new WebSocket(RPC_ENDPOINT);
        ws.onopen = () => {
            console.log('[LiveStream] Connected to RPC Provider.');
            // Structure the payload for the specific RPC provider (e.g. Helius accountSubscribe)
            const subscribePayload = {
                jsonrpc: '2.0',
                id: 1,
                method: 'accountSubscribe',
                params: [
                    trackedAddresses.length > 0 ? trackedAddresses[0] : 'placeholder_address', // Scaffold example
                    { encoding: 'jsonParsed', commitment: 'confirmed' }
                ]
            };
            ws?.send(JSON.stringify(subscribePayload));
        };
        ws.onmessage = async (event) => {
            try {
                const payload = JSON.parse(event.data);
                // Very basic scaffold parser assuming the RPC format matches expected
                if (payload.method === 'accountNotification') {
                    const transactionData = payload.params.result;
                    // Phase 15: Map raw transaction to the Scraper's ingest format
                    const formattedTrade = {
                        taker: transactionData.value.owner || '0xScaffoldDemo',
                        side: 'BUY',
                        price: '0.50',
                        size: '100',
                        timestamp: Math.floor(Date.now() / 1000).toString(),
                        transactionHash: '0xLiveTxHash...',
                        conditionId: '0xCondition...'
                    };
                    // Push into the exact same processing queue used by the historical scraper
                    const isValid = await (0, filterService_1.processTradeForFilter)(formattedTrade, false);
                    if (isValid) {
                        console.log(`[LiveStream] ⚡ LIVE Valid Trade detected from ${formattedTrade.taker}`);
                        // In a production environment, this pushes to an in-memory batching queue 
                        // that invokes a bulk DB insert every 500ms to avoid SQLITE_BUSY.
                    }
                }
            }
            catch (err) {
                console.error('[LiveStream] Failed analyzing message payload:', err);
            }
        };
        ws.onerror = (error) => {
            console.error('[LiveStream] WebSocket Error Event triggered.');
        };
        ws.onclose = () => {
            console.log('[LiveStream] Connection closed by remote host. Reconnecting in 5s...');
            reconnectTimer = setTimeout(() => {
                startLiveStream();
            }, 5000);
        };
    }
    catch (error) {
        console.error('[LiveStream] Initialization failed:', error);
    }
}
function stopLiveStream() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        console.log('[LiveStream] Intercepted. Closing WebSocket connection gracefully...');
        ws.onclose = null; // Prevent reconnect loop
        ws.close();
        ws = null;
    }
}
