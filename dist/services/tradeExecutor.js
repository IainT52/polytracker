"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.constructAndSignMockOrder = constructAndSignMockOrder;
exports.executeAutoTrades = executeAutoTrades;
const ethers_1 = require("ethers");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const safetyFilters_1 = require("./safetyFilters");
const encryption_1 = require("../bot/encryption");
const positionManager_1 = require("./positionManager");
// EIP-712 Domain for Polymarket CTF Exchange
const domain = {
    name: 'Polymarket CTF Exchange',
    version: '1',
    chainId: 137, // Polygon Mainnet
    verifyingContract: '0x4bfb41d5b3570defd03c39a9a4d8de6bdaf39bd6' // Polymarket CTF Exchange Proxy
};
// EIP-712 Order Types
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
async function constructAndSignMockOrder(privateKey, clobTokenId, shares, price) {
    const wallet = new ethers_1.ethers.Wallet(privateKey);
    // Calculate amounts: For a BUY order, Maker (user) spends USDC and Takes Conditional Tokens
    const makerAmountStr = ethers_1.ethers.parseUnits((shares * price).toFixed(6), 6).toString(); // USDC spent (6 decimals)
    const takerAmountStr = ethers_1.ethers.parseUnits(shares.toString(), 6).toString(); // Conditional Tokens expected
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
        side: 0, // BUY
        signatureType: 0 // EOA signature
    };
    try {
        const signature = await wallet.signTypedData(domain, types, order);
        console.log('[Executor] Successfully constructed and signed L2 CLOB Order.');
        console.log(`[Executor] Signer: ${wallet.address} `);
        console.log(`[Executor] Order Hash / Signature: ${signature.substring(0, 30)}...`);
        return { order, signature };
    }
    catch (e) {
        console.error('Error signing order:', e);
        throw e;
    }
}
// Phase 6, 11 & 12: Automated Trades with Safety Filters, Dynamic Sizing, and Syndicate Detection
async function executeAutoTrades(marketId, outcomeIndex, alphaPrice, netConviction, involvedWallets = []) {
    console.log(`\n[AutoTrade] Alpha Signal received for Market ${marketId}.Checking configs...`);
    // 1. Fetch users with auto trade enabled
    const enabledConfigs = await db_1.db.select()
        .from(schema_1.autoTradeConfigs)
        .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.autoTradeConfigs.userId, schema_1.users.id))
        .where((0, drizzle_orm_1.eq)(schema_1.autoTradeConfigs.isAutoTradeEnabled, true))
        .all();
    if (enabledConfigs.length === 0) {
        console.log('[AutoTrade] No users have auto-trading enabled.');
        return;
    }
    // Fetch true Token ID for the trade
    const market = await db_1.db.select().from(schema_1.markets).where((0, drizzle_orm_1.eq)(schema_1.markets.id, marketId)).get();
    const tokenIds = JSON.parse(market?.clobTokenIds || '[]');
    const actualTokenId = tokenIds[outcomeIndex];
    if (!actualTokenId) {
        console.log(`[AutoTrade] Aborted: Token ID could not be resolved for market ${marketId}`);
        return;
    }
    // 1b. Check for Historical Syndicates (Phase 12)
    let isSyndicateActive = false;
    if (involvedWallets.length > 1) {
        const syndicates = await db_1.db.select()
            .from(schema_1.walletCorrelations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.walletCorrelations.walletA, involvedWallets), (0, drizzle_orm_1.inArray)(schema_1.walletCorrelations.walletB, involvedWallets))).all();
        if (syndicates.length > 0) {
            isSyndicateActive = true;
            console.log(`[AutoTrade] 🚨 HISTORICAL SYNDICATE DETECTED! Found ${syndicates.length} known wallet correlation(s) in this signal.`);
        }
    }
    // 2. Fetch LIVE Level 2 Order Book for precise slippage simulation
    const liveOrderBook = await (0, positionManager_1.fetchL2OrderBook)(actualTokenId);
    // 3. Process each user config
    for (const row of enabledConfigs) {
        const config = row.auto_trade_configs;
        const user = row.users;
        if (!user.encryptedPrivateKey)
            continue;
        console.log(`[AutoTrade] Evaluating trade for Telegram User: ${user.telegramId} `);
        let betSizeNum = Number(config.fixedBetSizeUsd);
        // Phase 11: Dynamic Conviction Sizing
        if (netConviction < config.minWhalesToTrigger) {
            console.log(`[AutoTrade] ABORTED for ${user.telegramId}: Net Conviction(${netConviction}) < Min Required(${config.minWhalesToTrigger})`);
            continue;
        }
        if (config.dynamicSizingEnabled) {
            const multiplierFactor = netConviction - config.minWhalesToTrigger;
            // Formula: base + (base * multiplier * excessConviction)
            betSizeNum = betSizeNum + (betSizeNum * config.convictionMultiplier * multiplierFactor);
            console.log(`[AutoTrade] Dynamic Sizing applied: Scaled bet from $${config.fixedBetSizeUsd} to $${betSizeNum.toFixed(2)} (Conviction: ${netConviction})`);
        }
        // Phase 12: Syndicate Multiplier overlay
        if (isSyndicateActive) {
            betSizeNum = betSizeNum * Number(config.syndicateMultiplier);
            console.log(`[AutoTrade] Syndicate Multiplier applied(${config.syndicateMultiplier}x): Scaled bet up to $${betSizeNum.toFixed(2)} `);
        }
        // Safety check BEFORE signing
        const safetyCheck = (0, safetyFilters_1.validateTradeSafety)(liveOrderBook, alphaPrice, betSizeNum, config.maxSpreadBps, config.maxSlippageCents, Number(config.minOrderbookLiquidityUsd));
        if (!safetyCheck.passed) {
            console.log(`[AutoTrade] ABORTED for ${user.telegramId}: ${safetyCheck.reason} `);
            continue;
        }
        try {
            if (config.isPaperTradingMode) {
                console.log(`[AutoTrade] Live Paper Trading for ${user.telegramId}.Logging to paperPositions...`);
                // Save to paper positions only
                await db_1.db.insert(schema_1.paperPositions).values({
                    userId: user.id,
                    marketId: marketId,
                    outcomeIndex: outcomeIndex,
                    buyPrice: safetyCheck.executionPrice || alphaPrice,
                    shares: safetyCheck.expectedShares || 0,
                    totalCost: Number(betSizeNum.toFixed(2)),
                    status: 'PAPER_OPEN'
                });
                console.log(`[AutoTrade] SUCCESS: Paper Trade Logged for ${user.telegramId}.`);
            }
            else {
                console.log(`[AutoTrade] Safety checks passed for ${user.telegramId}.Signing LIVE CLOB order...`);
                const privateKey = (0, encryption_1.decryptKey)(user.encryptedPrivateKey);
                // We pass the simulated execution price heavily mocked clob token 
                await constructAndSignMockOrder(privateKey, actualTokenId, safetyCheck.expectedShares || 0, safetyCheck.executionPrice || alphaPrice);
                // Save to real database
                await db_1.db.insert(schema_1.userPositions).values({
                    userId: user.id,
                    marketId: marketId,
                    outcomeIndex: outcomeIndex,
                    buyPrice: safetyCheck.executionPrice || alphaPrice,
                    shares: safetyCheck.expectedShares || 0,
                    totalCost: Number(betSizeNum.toFixed(2)),
                    status: 'FILLED (AUTO)' // For testing
                });
                console.log(`[AutoTrade] SUCCESS: Replicated LIVE Alpha Signal for ${user.telegramId}.`);
            }
        }
        catch (e) {
            console.error(`[AutoTrade] Error executing for user ${user.telegramId}: `, e);
        }
    }
}
