CREATE TABLE `generation_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`prompt` text NOT NULL,
	`engine` text NOT NULL,
	`category` text NOT NULL,
	`resolution` text NOT NULL,
	`aspect` text NOT NULL,
	`duration` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_history_r2_key_unique` ON `generation_history` (`r2_key`);--> statement-breakpoint
CREATE INDEX `generation_history_owner_created_idx` ON `generation_history` (`owner_id`,`created_at`);