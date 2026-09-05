CREATE TABLE `apartment_complex_seed_memberships` (
	`complex_id` text NOT NULL,
	`seed_version` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`complex_id`, `seed_version`),
	FOREIGN KEY (`complex_id`) REFERENCES `apartment_complexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_apartment_complex_seed_memberships_version` ON `apartment_complex_seed_memberships` (`seed_version`,`complex_id`);