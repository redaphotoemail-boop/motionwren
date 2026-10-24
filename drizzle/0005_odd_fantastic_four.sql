CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_started_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_updated_idx` ON `rate_limits` (`updated_at`);--> statement-breakpoint
ALTER TABLE `generation_history` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `project_assets` ADD `provider_token` text;--> statement-breakpoint
ALTER TABLE `render_jobs` ADD `webhook_token` text;