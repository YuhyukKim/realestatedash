CREATE TABLE `complex_area_monthly_sales` (
	`complex_id` text NOT NULL,
	`district` text NOT NULL,
	`month` text NOT NULL,
	`area` real NOT NULL,
	`price_manwon` integer NOT NULL,
	`contract_date` text NOT NULL,
	PRIMARY KEY(`complex_id`, `area`, `month`),
	FOREIGN KEY (`complex_id`) REFERENCES `apartment_complexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_area_sales_district_month` ON `complex_area_monthly_sales` (`district`,`month`);--> statement-breakpoint
CREATE INDEX `idx_area_sales_month` ON `complex_area_monthly_sales` (`month`);