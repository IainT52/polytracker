CREATE TABLE `wallet_correlations` (
	`wallet_a` text NOT NULL,
	`wallet_b` text NOT NULL,
	`co_occurrence_count` integer DEFAULT 0 NOT NULL,
	`last_seen_together` integer NOT NULL,
	PRIMARY KEY(`wallet_a`, `wallet_b`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_markets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`condition_id` text NOT NULL,
	`question` text NOT NULL,
	`description` text,
	`outcomes` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_markets`("id", "condition_id", "question", "description", "outcomes", "resolved", "created_at", "updated_at") SELECT "id", "condition_id", "question", "description", "outcomes", "resolved", "created_at", "updated_at" FROM `markets`;--> statement-breakpoint
DROP TABLE `markets`;--> statement-breakpoint
ALTER TABLE `__new_markets` RENAME TO `markets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `markets_condition_id_unique` ON `markets` (`condition_id`);--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`market_id` integer NOT NULL,
	`outcome_index` integer NOT NULL,
	`action` text NOT NULL,
	`price` real NOT NULL,
	`shares` real NOT NULL,
	`timestamp` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL,
	`transaction_hash` text,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_trades`("id", "wallet_id", "market_id", "outcome_index", "action", "price", "shares", "timestamp", "transaction_hash") SELECT "id", "wallet_id", "market_id", "outcome_index", "action", "price", "shares", "timestamp", "transaction_hash" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
CREATE UNIQUE INDEX `trades_transaction_hash_unique` ON `trades` (`transaction_hash`);--> statement-breakpoint
CREATE INDEX `market_id_idx` ON `trades` (`market_id`);--> statement-breakpoint
CREATE INDEX `wallet_id_idx` ON `trades` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `timestamp_idx` ON `trades` (`timestamp`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` text NOT NULL,
	`username` text,
	`alerts_enabled` integer DEFAULT false NOT NULL,
	`paper_trading` integer DEFAULT true NOT NULL,
	`encrypted_private_key` text,
	`created_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "telegram_id", "username", "alerts_enabled", "paper_trading", "encrypted_private_key", "created_at", "updated_at") SELECT "id", "telegram_id", "username", "alerts_enabled", "paper_trading", "encrypted_private_key", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_id_unique` ON `users` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `__new_wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`grade` text,
	`roi` real,
	`win_rate` real,
	`recent_roi_30d` real,
	`recent_win_rate_30d` real,
	`last_analyzed` integer,
	`is_bot` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL,
	`updated_at` integer DEFAULT '"2026-03-06T21:28:22.019Z"' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_wallets`("id", "address", "grade", "roi", "win_rate", "recent_roi_30d", "recent_win_rate_30d", "last_analyzed", "is_bot", "created_at", "updated_at") SELECT "id", "address", "grade", "roi", "win_rate", "recent_roi_30d", "recent_win_rate_30d", "last_analyzed", "is_bot", "created_at", "updated_at" FROM `wallets`;--> statement-breakpoint
DROP TABLE `wallets`;--> statement-breakpoint
ALTER TABLE `__new_wallets` RENAME TO `wallets`;--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_address_unique` ON `wallets` (`address`);--> statement-breakpoint
CREATE INDEX `grade_idx` ON `wallets` (`grade`);--> statement-breakpoint
ALTER TABLE `auto_trade_configs` ADD `min_whales_to_trigger` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `auto_trade_configs` ADD `dynamic_sizing_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `auto_trade_configs` ADD `conviction_multiplier` real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `auto_trade_configs` ADD `syndicate_multiplier` real DEFAULT 1.5 NOT NULL;