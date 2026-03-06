import { db } from '../db';
import { userPositions, paperPositions, autoTradeConfigs, users, markets } from '../db/schema';
import { eq } from 'drizzle-orm';
import { OrderBook } from './safetyFilters';
import { fetchWithRetry, CLOB_API_URL } from './api';
import { decryptKey } from '../bot/encryption';
import { ethers } from 'ethers';

// EIP-712 Domain for Polymarket CTF Exchange
const domain = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137, // Polygon Mainnet
  verifyingContract: '0x4bfb41d5b3570defd03c39a9a4d8de6bdaf39bd6' // Proxy
};

const types = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' }
  ]
};

/**
 * Constructs a Limit Sell Order.
 * makerAmount = number of Conditional Tokens to sell
 * takerAmount = number of USDC expected in return based on the limitPrice
 */
export async function constructAndSignLimitSellOrder(privateKey: string, clobTokenId: string, shares: number, limitPrice: number) {
  const wallet = new ethers.Wallet(privateKey);

  const makerAmountStr = ethers.parseUnits(shares.toFixed(6), 6).toString(); // Conditional tokens
  const takerAmountStr = ethers.parseUnits((shares * limitPrice).toFixed(6), 6).toString(); // USDC expected

  const order = {
    salt: Math.floor(Math.random() * 1000000000),
    maker: wallet.address,
    signer: wallet.address,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: clobTokenId,
    makerAmount: makerAmountStr,
    takerAmount: takerAmountStr,
    expiration: Math.floor(Date.now() / 1000) + 3600, // +1 hour
    nonce: 0,
    feeRateBps: 0,
    side: 1, // 1 = SELL
    signatureType: 0 // EOA signature
  };

  try {
    const signature = await wallet.signTypedData(domain, types, order);
    console.log(`[PositionManager] Signed L2 LIMIT SELL Order for ${shares} shares @ $${limitPrice.toFixed(3)} minimum.`);
    return { order, signature };
  } catch (e) {
    console.error('Error signing sell order:', e);
    throw e;
  }
}

/**
 * Real API fetcher utilizing p-limit backoff utility
 */
export async function fetchL2OrderBook(clobTokenId: string): Promise<OrderBook> {
  try {
    const url = `${CLOB_API_URL}/book?token_id=${clobTokenId}`;
    const data = await fetchWithRetry(url);
    if (data && data.bids && data.asks) {
      return {
        bids: data.bids.map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })).sort((a: any, b: any) => b.price - a.price),
        asks: data.asks.map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })).sort((a: any, b: any) => a.price - b.price)
      };
    }
  } catch (e: any) {
    if (e.message !== 'Mock mode') {
      console.warn(`[PositionManager] Failed to fetch live L2 for ${clobTokenId}.`);
    }
  }
  return { bids: [], asks: [] }; // Empty safely
}

/**
 * Calculates weighted avg execution price iterating through Top BIDS
 */
export function simulateSellFill(orderBook: OrderBook, sharesToSell: number): { avgPrice: number, worstPrice: number, fillable: boolean } {
  let remainingShares = sharesToSell;
  let totalRevenue = 0;
  let worstPrice = 0;

  for (const bid of orderBook.bids) {
    if (remainingShares <= 0) break;
    const sharesFilled = Math.min(remainingShares, bid.size);
    totalRevenue += sharesFilled * bid.price;
    worstPrice = bid.price; // since bids are descending, the last one hit is the worst
    remainingShares -= sharesFilled;
  }

  if (remainingShares > 0) {
    return { avgPrice: 0, worstPrice: 0, fillable: false }; // Not enough liquidity to fully exit
  }

  return { avgPrice: totalRevenue / sharesToSell, worstPrice, fillable: true };
}

export async function managePositions() {
  console.log('[PositionManager] Running automated exit strategy check...');

  const configs = await db.select().from(autoTradeConfigs).all();
  const configMap = new Map(configs.map((c: any) => [c.userId, c]));

  const openPaper = await db.select().from(paperPositions).where(eq(paperPositions.status, 'PAPER_OPEN')).all();
  const openReal = await db.select().from(userPositions).where(eq(userPositions.status, 'OPEN')).all();

  await processPositions(openPaper, true, configMap);
  await processPositions(openReal, false, configMap);
}

async function processPositions(positions: any[], isPaper: boolean, configMap: Map<number, any>) {
  console.log(`[PositionManager] Processing ${positions.length} ${isPaper ? 'Paper' : 'Real'} positions`);
  console.log(`[PositionManager] Config Map Size: ${configMap.size}`);

  for (const pos of positions) {
    const config = configMap.get(pos.userId);
    if (!config) {
      console.log(`[PositionManager] No config for user ${pos.userId}`);
      continue;
    }

    const tpPct = config.takeProfitPct ?? 30;
    const slPct = config.stopLossPct ?? 20;

    const market = await db.select().from(markets).where(eq(markets.id, pos.marketId)).get();
    if (!market) {
      console.log(`[PositionManager] Market not found for pos ${pos.marketId}`);
      continue;
    }

    const tokenIds = JSON.parse(market.clobTokenIds || '[]');
    const actualTokenId = tokenIds[pos.outcomeIndex];
    if (!actualTokenId) {
      console.log(`[PositionManager] Cannot resolve actual Token ID for pos ${pos.id}`);
      continue;
    }

    const orderBook = await fetchL2OrderBook(actualTokenId);
    if (orderBook.bids.length === 0) {
      console.log(`[PositionManager] Orderbook empty or fetch failed for pos ${pos.id}`);
      continue;
    }

    const sharesNum = parseFloat(pos.shares);
    const buyPriceNum = parseFloat(pos.buyPrice);

    // 1. Simulate Slippage/Depth Check against level 2 Bids
    const { avgPrice, worstPrice, fillable } = simulateSellFill(orderBook, sharesNum);
    console.log(`[PositionManager] Pos ${pos.id} | Shares: ${sharesNum} | Buy: ${buyPriceNum} | Avg: ${avgPrice} | Fillable: ${fillable}`);
    if (!fillable) {
      console.log(`[PositionManager] Cannot exit Position ${pos.id} entirely - insufficient Bid liquidity.`);
      continue;
    }

    // 2. Calculate PnL based on the weighted avg execution price
    const rawPnL = ((avgPrice - buyPriceNum) / buyPriceNum) * 100;
    const currentPnL = Math.round(rawPnL * 100) / 100; // Round to 2 decimals
    let exitType: 'SOLD_TP' | 'SOLD_SL' | null = null;

    console.log(`[PositionManager] Pos ${pos.id} | PnL: ${currentPnL}% | TP: ${tpPct}% | SL: -${slPct}%`);

    if (currentPnL >= tpPct) exitType = 'SOLD_TP';
    else if (currentPnL <= -slPct) exitType = 'SOLD_SL';

    if (exitType) {
      console.log(`[PositionManager] Triggering exit for ${isPaper ? 'Paper' : 'Real'} Position ID ${pos.id}. Target: ${exitType}, PnL: ${currentPnL.toFixed(2)}%`);

      const realizedPnLNum = (avgPrice - buyPriceNum) * sharesNum;

      if (isPaper) {
        await db.update(paperPositions)
          .set({
            status: exitType,
            resolvedPrice: avgPrice,
            realizedPnL: Number(realizedPnLNum.toFixed(2))
          })
          .where(eq(paperPositions.id, pos.id));
      } else {
        const user = await db.select().from(users).where(eq(users.id, pos.userId)).get();
        if (user && user.encryptedPrivateKey) {
          const privateKey = decryptKey(user.encryptedPrivateKey);
          // 3. Limit Order Construction for real execution
          // Buffer by 1 cent below the worst acceptable fill from the simulation to ensure execution
          const limitPrice = Math.max(0.01, worstPrice - 0.01);

          await constructAndSignLimitSellOrder(
            privateKey,
            actualTokenId,
            sharesNum,
            limitPrice
          );

          await db.update(userPositions)
            .set({
              status: exitType,
            })
            .where(eq(userPositions.id, pos.id));
        }
      }
    }
  }
}
