CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `platform_settings` (`key`, `value`, `updated_at`) VALUES ('multi_shot_seconds_per_image', '5', strftime('%s','now') * 1000);
