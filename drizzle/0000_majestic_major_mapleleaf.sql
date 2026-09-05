CREATE TABLE `apartment_complexes` (
	`id` text PRIMARY KEY NOT NULL,
	`apt_seq` text,
	`kapt_code` text,
	`seoul_complex_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`district` text NOT NULL,
	`dong` text DEFAULT '' NOT NULL,
	`road_address` text,
	`jibun_address` text,
	`build_year` integer,
	`approval_date` text,
	`households` integer,
	`buildings` integer,
	`parking` integer,
	`latitude` real,
	`longitude` real,
	`area_min` real,
	`area_max` real,
	`source` text DEFAULT 'seoul-open-data' NOT NULL,
	`source_updated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_apartment_complexes_apt_seq` ON `apartment_complexes` (`apt_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_apartment_complexes_kapt_code` ON `apartment_complexes` (`kapt_code`);--> statement-breakpoint
CREATE INDEX `idx_apartment_complexes_district_dong_name` ON `apartment_complexes` (`district`,`dong`,`name`);--> statement-breakpoint
CREATE INDEX `idx_apartment_complexes_build_year` ON `apartment_complexes` (`build_year`);--> statement-breakpoint
CREATE INDEX `idx_apartment_complexes_normalized_name` ON `apartment_complexes` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `apartment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`complex_id` text NOT NULL,
	`transaction_type` text NOT NULL,
	`contract_date` text NOT NULL,
	`price_manwon` integer NOT NULL,
	`monthly_rent_manwon` integer DEFAULT 0 NOT NULL,
	`area` real NOT NULL,
	`floor` integer,
	`source` text DEFAULT 'molit' NOT NULL,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`complex_id`) REFERENCES `apartment_complexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_apartment_transactions_complex_type_date` ON `apartment_transactions` (`complex_id`,`transaction_type`,`contract_date`);--> statement-breakpoint
CREATE INDEX `idx_apartment_transactions_contract_date` ON `apartment_transactions` (`contract_date`);--> statement-breakpoint
CREATE TABLE `complex_areas` (
	`complex_id` text NOT NULL,
	`area` real NOT NULL,
	FOREIGN KEY (`complex_id`) REFERENCES `apartment_complexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uidx_complex_areas_complex_area` ON `complex_areas` (`complex_id`,`area`);--> statement-breakpoint
CREATE INDEX `idx_complex_areas_area` ON `complex_areas` (`area`);--> statement-breakpoint
CREATE TABLE `complex_price_summaries` (
	`complex_id` text PRIMARY KEY NOT NULL,
	`latest_sale_price_manwon` integer,
	`latest_sale_date` text,
	`latest_sale_area` real,
	`latest_jeonse_price_manwon` integer,
	`latest_jeonse_date` text,
	`latest_jeonse_area` real,
	`latest_monthly_deposit_manwon` integer,
	`latest_monthly_rent_manwon` integer,
	`latest_monthly_date` text,
	`latest_monthly_area` real,
	`sale_count` integer DEFAULT 0 NOT NULL,
	`rent_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`complex_id`) REFERENCES `apartment_complexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_complex_price_summaries_sale_price` ON `complex_price_summaries` (`latest_sale_price_manwon`);--> statement-breakpoint
CREATE INDEX `idx_complex_price_summaries_sale_date` ON `complex_price_summaries` (`latest_sale_date`);--> statement-breakpoint
CREATE TABLE `data_sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`record_count` integer DEFAULT 0 NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_data_sync_runs_source_started` ON `data_sync_runs` (`source`,`started_at`);