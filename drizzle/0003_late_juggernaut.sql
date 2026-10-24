ALTER TABLE `projects` ADD `listing_url` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `generation_engine` text DEFAULT 'studio' NOT NULL;