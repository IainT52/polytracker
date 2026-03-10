"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLOB_WS_URL = exports.DATA_API_URL = exports.CLOB_API_URL = exports.GAMMA_API_URL = void 0;
exports.fetchWithRetry = fetchWithRetry;
exports.fetchActiveMarkets = fetchActiveMarkets;
exports.fetchMarketTrades = fetchMarketTrades;
const p_limit_1 = __importDefault(require("p-limit"));
// Limit to 15 concurrent requests to stay under 200 req/10s safely
const polymarketLimit = (0, p_limit_1.default)(15);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function fetchWithRetry(url, options = {}, retries = 3) {
    return polymarketLimit(async () => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(url, options);
                // Handle Rate Limits specifically
                if (response.status === 429) {
                    console.warn(`[API] Rate limited on ${url} (Attempt ${attempt}/${retries}). Backing off...`);
                    if (attempt === retries) {
                        throw new Error(`Rate Limited after ${retries} attempts`);
                    }
                    // Exponential backoff: 2s, 4s, 8s
                    await wait(1000 * Math.pow(2, attempt));
                    continue;
                }
                if (!response.ok) {
                    if (response.status === 400) {
                        throw new Error(`HTTP Error: 400 - Bad Request`);
                    }
                    throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
                }
                const data = await response.json();
                return data;
            }
            catch (error) {
                // Fast-fail on 400 errors, bypassing delays and retries
                if (error.message && error.message.includes('400')) {
                    throw error;
                }
                if (attempt === retries) {
                    console.error(`[API] Failed to fetch ${url} after ${retries} attempts:`, error.message);
                    throw error;
                }
                await wait(1000 * attempt);
            }
        }
    });
}
// Polymarket URL Constants
exports.GAMMA_API_URL = 'https://gamma-api.polymarket.com';
exports.CLOB_API_URL = 'https://clob.polymarket.com';
exports.DATA_API_URL = 'https://data-api.polymarket.com';
exports.CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
/**
 * Fetch top active markets from Gamma API
 * Sorted globally by volume to target high-liquidity events
 */
async function fetchActiveMarkets(limit = 1000, offset = 0) {
    const url = `${exports.GAMMA_API_URL}/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
    const events = await fetchWithRetry(url);
    const markets = [];
    for (const event of events) {
        if (event.markets && event.markets.length > 0) {
            for (const m of event.markets) {
                markets.push({
                    id: m.id,
                    conditionId: m.conditionId,
                    question: m.question,
                    slug: event.slug || '',
                    description: m.description,
                    outcomes: JSON.parse(m.outcomes || '[]'),
                    clobTokenIds: m.clobTokenIds || m.tokens?.map((t) => t.token_id) || [],
                    category: event.category || 'Uncategorized',
                    tags: event.tags || [],
                    volume: parseFloat(m.volume || '0'),
                    endDate: m.endDate || '',
                    icon: m.icon || '',
                    active: m.active,
                    closed: m.closed,
                });
            }
        }
    }
    return markets;
}
/**
 * Fetch historical trades for a specific market Condition ID using CLOB API
 * Implements Deep Cursor Pagination for Phase 10 High-Volume extraction
 */
async function fetchMarketTrades(conditionId, maxTrades = 20000, latestTs = 0) {
    const mappedTrades = [];
    let offset = 0;
    // The API max limit per page is typically 500
    const limitPerPage = 500;
    while (mappedTrades.length < maxTrades) {
        let url = `${exports.DATA_API_URL}/trades?market=${conditionId}&limit=${limitPerPage}&offset=${offset}`;
        let payload;
        try {
            payload = await fetchWithRetry(url);
        }
        catch (e) {
            if (e.message.includes('400')) {
                console.warn('[API] Reached API offset limit, gracefully saving fetched trades.');
                break; // Gracefully exit the loop and return what we have
            }
            throw e; // Re-throw if it's a 500 or other unexpected error
        }
        let rawTrades = [];
        if (Array.isArray(payload)) {
            rawTrades = payload;
        }
        else {
            break; // Unknown format, safe exit
        }
        if (rawTrades.length === 0)
            break;
        let reachedExistingData = false;
        for (const data of rawTrades) {
            if (!data.proxyWallet || !data.transactionHash)
                continue;
            const tradeTs = parseInt(data.timestamp) * 1000;
            if (tradeTs <= latestTs) {
                reachedExistingData = true;
                break; // Break the inner loop
            }
            mappedTrades.push({
                id: data.transactionHash,
                transactionHash: data.transactionHash,
                maker: '0x0000000000000000000000000000000000000000',
                taker: data.proxyWallet.toLowerCase(),
                price: data.price.toString(),
                size: data.size.toString(),
                side: data.side,
                timestamp: data.timestamp.toString(),
                market: conditionId,
                asset_id: data.asset,
                outcomeIndex: data.outcomeIndex
            });
        }
        if (reachedExistingData) {
            console.log(`[API] Reached existing data for ${conditionId} past ${latestTs}ms. Halting deep pagination.`);
            break; // Break the overarching while loop, preventing next API offset hit!
        }
        // Increment offset
        offset += rawTrades.length;
        // Tiny artificial delay between pages to ensure we don't trigger IP burn
        if (rawTrades.length === limitPerPage)
            await wait(100);
        // If we received fewer trades than the limit, we've hit the end of the history
        if (rawTrades.length < limitPerPage)
            break;
    }
    return mappedTrades.slice(0, maxTrades);
}
