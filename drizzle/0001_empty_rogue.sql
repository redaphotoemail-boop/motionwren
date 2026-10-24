CREATE TABLE `render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`prediction_ids` text NOT NULL,
	`segment_urls` text NOT NULL,
	`stitch_prediction_id` text,
	`prompt` text NOT NULL,
	`category` text NOT NULL,
	`resolution` text NOT NULL,
	`aspect` text NOT NULL,
	`duration` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`error` text,
	`history_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `render_jobs_owner_status_created_idx` ON `render_jobs` (`owner_id`,`status`,`created_at`);