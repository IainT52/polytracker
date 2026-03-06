CREATE TABLE `auto_trade_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`is_auto_trade_enabled` integer DEFAULT false NOT NULL,
	`is_paper_trading_mode` integer DEFAULT true NOT NULL,
	`max_spread_bps` integer DEFAULT 200 NOT NULL,
	`max_slippage_cents` integer DEFAULT 2 NOT NULL,
	`min_orderbook_liquidity_usd` text DEFAULT '500' NOT NULL,
	`fixed_bet_size_usd` text DEFAULT '10' NOT NULL,
	`take_profit_pct` integer DEFAULT 30 NOT NULL,
	`stop_loss_pct` integer DEFAULT 20 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auto_trade_configs_user_id_unique` ON `auto_trade_configs` (`user_id`);--> statement-breakpoint
CREATE TABLE `markets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condition_id` text NOT NULL,
	`question` text NOT NULL,
	`description` text,
	`outcomes` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `markets_condition_id_unique` ON `markets` (`condition_id`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`market_id` integer NOT NULL,
	`outcome_index` integer NOT NULL,
	`buy_price` text NOT NULL,
	`shares` text NOT NULL,
	`total_cost` text NOT NULL,
	`resolved_price` text,
	`realized_pnl` text,
	`timestamp` integer NOT NULL,
	`status` text DEFAULT 'PAPER_OPEN' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`market_id` integer NOT NULL,
	`outcome_index` integer NOT NULL,
	`action` text NOT NULL,
	`price` real NOT NULL,
	`shares` real NOT NULL,
	`timestamp` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL,
	`transaction_hash` text,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_transaction_hash_unique` ON `trades` (`transaction_hash`);--> statement-breakpoint
CREATE TABLE `user_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`market_id` integer NOT NULL,
	`outcome_index` integer NOT NULL,
	`buy_price` text NOT NULL,
	`shares` text NOT NULL,
	`total_cost` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`order_id` text,
	`transaction_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` text NOT NULL,
	`username` text,
	`alerts_enabled` integer DEFAULT false NOT NULL,
	`paper_trading` integer DEFAULT true NOT NULL,
	`encrypted_private_key` text,
	`created_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`grade` text,
	`roi` real,
	`win_rate` real,
	`last_analyzed` integer,
	`is_bot` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T01:55:02.143Z"' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_address_unique` ON `wallets` (`address`);