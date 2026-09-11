CREATE TABLE `trade_import_prices` (
	`run_id` text NOT NULL,
	`complex_id` text NOT NULL,
	`area` real NOT NULL,
	`price_manwon` integer NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`run_id`, `complex_id`, `area`),
	FOREIGN KEY (`run_id`) REFERENCES `trade_import_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trade_import_rows` (
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`complex_id` text,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`price_manwon` integer NOT NULL,
	`monthly_rent` integer NOT NULL,
	`area` real NOT NULL,
	`floor` integer,
	`payload` text NOT NULL,
	`batch_hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `ordinal`),
	FOREIGN KEY (`run_id`) REFERENCES `trade_import_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trade_import_complex` ON `trade_import_rows` (`run_id`,`complex_id`,`date`);--> statement-breakpoint
CREATE TABLE `trade_import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`district` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`expected_count` integer NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`committed` integer DEFAULT 0 NOT NULL,
	`abandoned` integer DEFAULT 0 NOT NULL,
	`mapping_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_trade_import_scope` ON `trade_import_runs` (`district`,`month`,`kind`);--> statement-breakpoint
CREATE TABLE `trade_snapshot_heads` (
	`district` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`run_id` text NOT NULL,
	`fetched_at` text NOT NULL,
	`record_count` integer NOT NULL,
	PRIMARY KEY(`district`, `month`, `kind`),
	FOREIGN KEY (`run_id`) REFERENCES `trade_import_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_trade_heads_month_kind` ON `trade_snapshot_heads` (`month`,`kind`);