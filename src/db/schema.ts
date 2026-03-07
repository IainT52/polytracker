import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: text('telegram_id').notNull().unique(),
  username: text('username'),
  alertsEnabled: integer('alerts_enabled', { mode: 'boolean' }).default(false).notNull(),
  paperTrading: integer('paper_trading', { mode: 'boolean' }).default(true).notNull(),
  encryptedPrivateKey: text('encrypted_private_key'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
});

export const wallets = sqliteTable('wallets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull().unique(),
  grade: text('grade'), // A, B, C, D
  roi: real('roi'),
  winRate: real('win_rate'),
  recentRoi30d: real('recent_roi_30d'),
  recentWinRate30d: real('recent_win_rate_30d'),
  totalTrades: integer('total_trades'),
  totalVolume: real('total_volume'),
  realizedPnL: real('realized_pnl'),
  lastAnalyzed: integer('last_analyzed', { mode: 'timestamp' }),
  isBot: integer('is_bot', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
}, (table) => {
  return {
    gradeIdx: index('grade_idx').on(table.grade)
  }
});

export const markets = sqliteTable('markets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conditionId: text('condition_id').notNull().unique(),
  question: text('question').notNull(),
  description: text('description'),
  outcomes: text('outcomes').notNull(), // JSON stringified array e.g. '["Yes", "No"]'
  clobTokenIds: text('clob_token_ids').notNull().default('[]'),
  volume: real('volume'),
  endDate: text('end_date'),
  icon: text('icon'),
  resolved: integer('resolved', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(new Date()),
});

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  walletId: integer('wallet_id').references(() => wallets.id).notNull(),
  marketId: integer('market_id').references(() => markets.id).notNull(),
  outcomeIndex: integer('outcome_index').notNull(),
  action: text('action').notNull(), // "BUY" or "SELL"
  price: real('price').notNull(),
  shares: real('shares').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(new Date()),
  transactionHash: text('transaction_hash').unique(),
}, (table) => {
  return {
    marketIdIdx: index('market_id_idx').on(table.marketId),
    walletIdIdx: index('wallet_id_idx').on(table.walletId),
    timestampIdx: index('timestamp_idx').on(table.timestamp)
  }
});

// User Positions (Web3 Copy Trading)
export const userPositions = sqliteTable('user_positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  marketId: integer('market_id').notNull().references(() => markets.id),
  outcomeIndex: integer('outcome_index').notNull(),
  buyPrice: real('buy_price').notNull(),
  shares: real('shares').notNull(),
  totalCost: real('total_cost').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  status: text('status').notNull().default('OPEN'), // OPEN, SOLD_TP, SOLD_SL
  orderId: text('order_id'),
  transactionHash: text('transaction_hash')
});

// Automated Web Dashboard Trading Configs
export const autoTradeConfigs = sqliteTable('auto_trade_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  isAutoTradeEnabled: integer('is_auto_trade_enabled', { mode: 'boolean' }).default(false).notNull(),
  isPaperTradingMode: integer('is_paper_trading_mode', { mode: 'boolean' }).default(true).notNull(),
  maxSpreadBps: integer('max_spread_bps').notNull().default(200), // Max allowable spread (e.g. 200 = 2%)
  maxSlippageCents: integer('max_slippage_cents').notNull().default(2), // Max cent deviation from signal price
  minOrderbookLiquidityUsd: text('min_orderbook_liquidity_usd').notNull().default('500'), // Min USD depth
  fixedBetSizeUsd: text('fixed_bet_size_usd').notNull().default('10'), // Fixed USDC deploy amount

  // Phase 11 & 12: Dynamic Sizing, Directional Consensus, & Syndicates
  minWhalesToTrigger: integer('min_whales_to_trigger').notNull().default(2),
  dynamicSizingEnabled: integer('dynamic_sizing_enabled', { mode: 'boolean' }).default(false).notNull(),
  convictionMultiplier: real('conviction_multiplier').notNull().default(0.5),
  syndicateMultiplier: real('syndicate_multiplier').notNull().default(1.5),

  takeProfitPct: integer('take_profit_pct').notNull().default(30), // Target profit percentage (e.g. 30 = 30%)
  stopLossPct: integer('stop_loss_pct').notNull().default(20), // Cut losses percentage (e.g. 20 = 20%)
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()), // Dynamic tracking
});

// Phase 7: The Simulation Engine (Live Paper Trading & Backtesting)
export const paperPositions = sqliteTable('paper_positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  marketId: integer('market_id').notNull().references(() => markets.id),
  outcomeIndex: integer('outcome_index').notNull(),
  buyPrice: real('buy_price').notNull(),
  shares: real('shares').notNull(),
  totalCost: real('total_cost').notNull(),
  resolvedPrice: real('resolved_price'), // Price when market closed
  realizedPnL: real('realized_pnl'), // Final PnL
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  status: text('status').notNull().default('PAPER_OPEN'), // PAPER_OPEN, PAPER_WON, PAPER_LOST, SOLD_TP, SOLD_SL
});

// Phase 12: Historical Syndicate Detection & Correlation Matrix
export const walletCorrelations = sqliteTable('wallet_correlations', {
  walletA: text('wallet_a').notNull(),
  walletB: text('wallet_b').notNull(),
  coOccurrenceCount: integer('co_occurrence_count').notNull().default(0),
  lastSeenTogether: integer('last_seen_together', { mode: 'timestamp' }).notNull()
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.walletA, table.walletB] }),
  }
});
