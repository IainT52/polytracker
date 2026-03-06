import pLimit from 'p-limit';

// Limit to 15 concurrent requests to stay under 200 req/10s safely
const polymarketLimit = pLimit(15);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<any> {
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
          throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        return data;
      } catch (error: any) {
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
export const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
export const CLOB_API_URL = 'https://clob.polymarket.com';
export const DATA_API_URL = 'https://data-api.polymarket.com';
export const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export interface MarketMetadata {
  id: string; // Internal id / Condition ID
  conditionId: string;
  question: string;
  description: string;
  outcomes: string[];
  clobTokenIds: string[];
  active: boolean;
  closed: boolean;
}

export interface TradeData {
  id: string;
  transactionHash: string;
  maker: string;
  taker: string;
  price: string;
  size: string; // Shares
  side: 'BUY' | 'SELL';
  timestamp: string;
  market?: string;
  asset_id?: string;
}

/**
 * Fetch top active markets from Gamma API
 * Sorted globally by volume to target high-liquidity events
 */
export async function fetchActiveMarkets(limit = 100, offset = 0): Promise<MarketMetadata[]> {
  const url = `${GAMMA_API_URL}/events?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
  const events = await fetchWithRetry(url);

  const markets: MarketMetadata[] = [];
  for (const event of events) {
    if (event.markets && event.markets.length > 0) {
      for (const m of event.markets) {
        markets.push({
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          description: m.description,
          outcomes: JSON.parse(m.outcomes || '[]'),
          clobTokenIds: m.clobTokenIds || m.tokens?.map((t: any) => t.token_id) || [],
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
export async function fetchMarketTrades(conditionId: string, maxTrades = 20000): Promise<TradeData[]> {
  const mappedTrades: TradeData[] = [];
  let cursor = '';

  // The API max limit per page is typically 500
  const limitPerPage = 500;

  do {
    let url = `${DATA_API_URL}/trades?market=${conditionId}&limit=${limitPerPage}`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const payload = await fetchWithRetry(url);

    // The Data API returns an array directly if it's the last page or standard payload,
    // or an object { data: [], next_cursor: '' } if paginated
    let rawTrades = [];
    let nextCursor = '';

    if (Array.isArray(payload)) {
      rawTrades = payload;
      cursor = ''; // End of data
    } else if (payload && payload.data) {
      rawTrades = payload.data;
      nextCursor = payload.next_cursor || '';
      cursor = nextCursor;
    } else {
      break; // Unknown format, safe exit
    }

    if (rawTrades.length === 0) break;

    for (const data of rawTrades) {
      if (!data.proxyWallet || !data.transactionHash) continue;

      mappedTrades.push({
        id: data.transactionHash,
        transactionHash: data.transactionHash,
        maker: '0x0000000000000000000000000000000000000000',
        taker: data.proxyWallet.toLowerCase(),
        price: data.price.toString(),
        size: data.size.toString(),
        side: data.side as 'BUY' | 'SELL',
        timestamp: data.timestamp.toString(),
        market: conditionId,
        asset_id: data.asset_id
      });
    }

    // Safety checks for deep pagination
    if (mappedTrades.length >= maxTrades) break;

    // Tiny artificial delay between pages to ensure we don't trigger IP burn
    if (cursor && cursor !== 'LTE=') await wait(100);

  } while (cursor && cursor !== 'LTE='); // Polymarket end cursor often looks like LTE= or just empty

  return mappedTrades.slice(0, maxTrades);
}
