"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syndicateMembers = exports.syndicates = exports.walletCorrelations = exports.paperPositions = exports.autoTradeConfigs = exports.userPositions = exports.trades = exports.markets = exports.wallets = exports.users = void 0;
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, sqlite_core_1.sqliteTable)('users', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    telegramId: (0, sqlite_core_1.text)('telegram_id').notNull().unique(),
    username: (0, sqlite_core_1.text)('username'),
    alertsEnabled: (0, sqlite_core_1.integer)('alerts_enabled', { mode: 'boolean' }).default(false).notNull(),
    paperTrading: (0, sqlite_core_1.integer)('paper_trading', { mode: 'boolean' }).default(true).notNull(),
    encryptedPrivateKey: (0, sqlite_core_1.text)('encrypted_private_key'),
    createdAt: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
    updatedAt: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
});
exports.wallets = (0, sqlite_core_1.sqliteTable)('wallets', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    address: (0, sqlite_core_1.text)('address').notNull().unique(),
    grade: (0, sqlite_core_1.text)('grade'), // A, B, C, D
    roi: (0, sqlite_core_1.real)('roi'),
    winRate: (0, sqlite_core_1.real)('win_rate'),
    recentRoi30d: (0, sqlite_core_1.real)('recent_roi_30d'),
    recentWinRate30d: (0, sqlite_core_1.real)('recent_win_rate_30d'),
    totalTrades: (0, sqlite_core_1.integer)('total_trades'),
    totalVolume: (0, sqlite_core_1.real)('total_volume'),
    realizedPnL: (0, sqlite_core_1.real)('realized_pnl'),
    lastAnalyzed: (0, sqlite_core_1.integer)('last_analyzed', { mode: 'timestamp' }),
    isBot: (0, sqlite_core_1.integer)('is_bot', { mode: 'boolean' }).default(false).notNull(),
    createdAt: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
    updatedAt: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
}, (table) => {
    return {
        gradeIdx: (0, sqlite_core_1.index)('grade_idx').on(table.grade)
    };
});
exports.markets = (0, sqlite_core_1.sqliteTable)('markets', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    conditionId: (0, sqlite_core_1.text)('condition_id').notNull().unique(),
    question: (0, sqlite_core_1.text)('question').notNull(),
    slug: (0, sqlite_core_1.text)('slug'),
    description: (0, sqlite_core_1.text)('description'),
    outcomes: (0, sqlite_core_1.text)('outcomes').notNull(), // JSON stringified array e.g. '["Yes", "No"]'
    clobTokenIds: (0, sqlite_core_1.text)('clob_token_ids').notNull().default('[]'),
    category: (0, sqlite_core_1.text)('category').notNull().default('Uncategorized'),
    tags: (0, sqlite_core_1.text)('tags').notNull().default('[]'), // JSON stringified array of tags
    volume: (0, sqlite_core_1.real)('volume'),
    endDate: (0, sqlite_core_1.text)('end_date'),
    icon: (0, sqlite_core_1.text)('icon'),
    resolved: (0, sqlite_core_1.integer)('resolved', { mode: 'boolean' }).default(false).notNull(),
    alphaSignalFired: (0, sqlite_core_1.integer)('alpha_signal_fired', { mode: 'boolean' }).default(false).notNull(),
    createdAt: (0, sqlite_core_1.integer)('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
    updatedAt: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
});
exports.trades = (0, sqlite_core_1.sqliteTable)('trades', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    walletId: (0, sqlite_core_1.integer)('wallet_id').references(() => exports.wallets.id).notNull(),
    marketId: (0, sqlite_core_1.integer)('market_id').references(() => exports.markets.id).notNull(),
    outcomeIndex: (0, sqlite_core_1.integer)('outcome_index').notNull(),
    action: (0, sqlite_core_1.text)('action').notNull(), // "BUY" or "SELL"
    price: (0, sqlite_core_1.real)('price').notNull(),
    shares: (0, sqlite_core_1.real)('shares').notNull(),
    timestamp: (0, sqlite_core_1.integer)('timestamp', { mode: 'timestamp' }).notNull().default(new Date()),
    transactionHash: (0, sqlite_core_1.text)('transaction_hash').unique(),
}, (table) => {
    return {
        marketIdIdx: (0, sqlite_core_1.index)('market_id_idx').on(table.marketId),
        walletIdIdx: (0, sqlite_core_1.index)('wallet_id_idx').on(table.walletId),
        timestampIdx: (0, sqlite_core_1.index)('timestamp_idx').on(table.timestamp)
    };
});
// User Positions (Web3 Copy Trading)
exports.userPositions = (0, sqlite_core_1.sqliteTable)('user_positions', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    userId: (0, sqlite_core_1.integer)('user_id').notNull().references(() => exports.users.id),
    marketId: (0, sqlite_core_1.integer)('market_id').notNull().references(() => exports.markets.id),
    outcomeIndex: (0, sqlite_core_1.integer)('outcome_index').notNull(),
    buyPrice: (0, sqlite_core_1.real)('buy_price').notNull(),
    shares: (0, sqlite_core_1.real)('shares').notNull(),
    totalCost: (0, sqlite_core_1.real)('total_cost').notNull(),
    timestamp: (0, sqlite_core_1.integer)('timestamp', { mode: 'timestamp' }).notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    status: (0, sqlite_core_1.text)('status').notNull().default('OPEN'), // OPEN, SOLD_TP, SOLD_SL
    orderId: (0, sqlite_core_1.text)('order_id'),
    transactionHash: (0, sqlite_core_1.text)('transaction_hash')
});
// Automated Web Dashboard Trading Configs
exports.autoTradeConfigs = (0, sqlite_core_1.sqliteTable)('auto_trade_configs', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    userId: (0, sqlite_core_1.integer)('user_id').notNull().references(() => exports.users.id).unique(),
    isAutoTradeEnabled: (0, sqlite_core_1.integer)('is_auto_trade_enabled', { mode: 'boolean' }).default(false).notNull(),
    isPaperTradingMode: (0, sqlite_core_1.integer)('is_paper_trading_mode', { mode: 'boolean' }).default(true).notNull(),
    maxSpreadBps: (0, sqlite_core_1.integer)('max_spread_bps').notNull().default(200), // Max allowable spread (e.g. 200 = 2%)
    maxSlippageCents: (0, sqlite_core_1.integer)('max_slippage_cents').notNull().default(2), // Max cent deviation from signal price
    minOrderbookLiquidityUsd: (0, sqlite_core_1.text)('min_orderbook_liquidity_usd').notNull().default('500'), // Min USD depth
    fixedBetSizeUsd: (0, sqlite_core_1.text)('fixed_bet_size_usd').notNull().default('10'), // Fixed USDC deploy amount
    // Phase 11 & 12: Dynamic Sizing, Directional Consensus, & Syndicates
    minWhalesToTrigger: (0, sqlite_core_1.integer)('min_whales_to_trigger').notNull().default(2),
    dynamicSizingEnabled: (0, sqlite_core_1.integer)('dynamic_sizing_enabled', { mode: 'boolean' }).default(false).notNull(),
    convictionMultiplier: (0, sqlite_core_1.real)('conviction_multiplier').notNull().default(0.5),
    syndicateMultiplier: (0, sqlite_core_1.real)('syndicate_multiplier').notNull().default(1.5),
    takeProfitPct: (0, sqlite_core_1.integer)('take_profit_pct').notNull().default(30), // Target profit percentage (e.g. 30 = 30%)
    stopLossPct: (0, sqlite_core_1.integer)('stop_loss_pct').notNull().default(20), // Cut losses percentage (e.g. 20 = 20%)
    updatedAt: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()), // Dynamic tracking
});
// Phase 7: The Simulation Engine (Live Paper Trading & Backtesting)
exports.paperPositions = (0, sqlite_core_1.sqliteTable)('paper_positions', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    userId: (0, sqlite_core_1.integer)('user_id').notNull().references(() => exports.users.id),
    marketId: (0, sqlite_core_1.integer)('market_id').notNull().references(() => exports.markets.id),
    outcomeIndex: (0, sqlite_core_1.integer)('outcome_index').notNull(),
    buyPrice: (0, sqlite_core_1.real)('buy_price').notNull(),
    shares: (0, sqlite_core_1.real)('shares').notNull(),
    totalCost: (0, sqlite_core_1.real)('total_cost').notNull(),
    resolvedPrice: (0, sqlite_core_1.real)('resolved_price'), // Price when market closed
    realizedPnL: (0, sqlite_core_1.real)('realized_pnl'), // Final PnL
    timestamp: (0, sqlite_core_1.integer)('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    status: (0, sqlite_core_1.text)('status').notNull().default('PAPER_OPEN'), // PAPER_OPEN, PAPER_WON, PAPER_LOST, SOLD_TP, SOLD_SL
});
// Phase 12: Historical Syndicate Detection & Correlation Matrix
exports.walletCorrelations = (0, sqlite_core_1.sqliteTable)('wallet_correlations', {
    walletA: (0, sqlite_core_1.text)('wallet_a').notNull(),
    walletB: (0, sqlite_core_1.text)('wallet_b').notNull(),
    coOccurrenceCount: (0, sqlite_core_1.integer)('co_occurrence_count').notNull().default(0),
    lastSeenTogether: (0, sqlite_core_1.integer)('last_seen_together', { mode: 'timestamp' }).notNull()
}, (table) => {
    return {
        pk: (0, sqlite_core_1.primaryKey)({ columns: [table.walletA, table.walletB] }),
    };
});
// Phase 21: N-Size Syndicate Clustering
exports.syndicates = (0, sqlite_core_1.sqliteTable)('syndicates', {
    id: (0, sqlite_core_1.integer)('id').primaryKey({ autoIncrement: true }),
    name: (0, sqlite_core_1.text)('name').notNull(),
    size: (0, sqlite_core_1.integer)('size').notNull(),
    combinedPnL: (0, sqlite_core_1.real)('combined_pnl').notNull(),
    winRate: (0, sqlite_core_1.real)('win_rate').notNull(),
    targetVolumeLevel: (0, sqlite_core_1.real)('target_volume_level').notNull(),
    topKeywords: (0, sqlite_core_1.text)('top_keywords').notNull(),
    updatedAt: (0, sqlite_core_1.integer)('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});
exports.syndicateMembers = (0, sqlite_core_1.sqliteTable)('syndicate_members', {
    syndicateId: (0, sqlite_core_1.integer)('syndicate_id').notNull().references(() => exports.syndicates.id, { onDelete: 'cascade' }),
    walletAddress: (0, sqlite_core_1.text)('wallet_address').notNull().references(() => exports.wallets.address, { onDelete: 'cascade' }),
}, (table) => {
    return {
        pk: (0, sqlite_core_1.primaryKey)({ columns: [table.syndicateId, table.walletAddress] }),
    };
});
