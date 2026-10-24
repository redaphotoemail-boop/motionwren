CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`render_job_id` text,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_key_unique` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_owner_created_idx` ON `credit_ledger` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_owner_created_idx` ON `notifications` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text DEFAULT 'source_image' NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_assets_r2_key_unique` ON `project_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `project_assets_project_order_idx` ON `project_assets` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `project_assets_owner_idx` ON `project_assets` (`owner_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`listing_address` text,
	`beds` text,
	`baths` text,
	`square_feet` text,
	`price` text,
	`short_message` text,
	`aspect` text DEFAULT 'horizontal' NOT NULL,
	`resolution` text DEFAULT '1080p' NOT NULL,
	`agent_name` text,
	`agent_email` text,
	`agent_phone` text,
	`render_job_id` text,
	`final_history_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner_created_idx` ON `projects` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_status_updated_idx` ON `projects` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`provider_subscription_id` text,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_provider_subscription_id_unique` ON `subscriptions` (`provider_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_owner_status_idx` ON `subscriptions` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'customer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`plan` text DEFAULT 'internal' NOT NULL,
	`credit_balance` integer DEFAULT 0 NOT NULL,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `generation_history` ADD `size_bytes` integer;