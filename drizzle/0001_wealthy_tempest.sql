CREATE TABLE `client_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`upload_token_hash` text NOT NULL,
	`client_name` text NOT NULL,
	`client_email` text NOT NULL,
	`business_name` text NOT NULL,
	`project_name` text NOT NULL,
	`package_seconds` integer NOT NULL,
	`style` text NOT NULL,
	`notes` text NOT NULL,
	`status` text NOT NULL,
	`photo_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `client_jobs_status_created_idx` ON `client_jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_jobs_email_created_idx` ON `client_jobs` (`client_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `job_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `client_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_assets_r2_key_unique` ON `job_assets` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_assets_job_position_unique` ON `job_assets` (`job_id`,`position`);--> statement-breakpoint
CREATE INDEX `job_assets_job_idx` ON `job_assets` (`job_id`);