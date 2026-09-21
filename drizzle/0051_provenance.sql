CREATE TABLE `review_confirms` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text DEFAULT '' NOT NULL,
	`surface` text NOT NULL,
	`subject_id` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `review_confirms_user` ON `review_confirms` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `content_variants` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `lead_magnets` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `lead_magnets` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `webinar_sections` ADD `origin` text;--> statement-breakpoint
UPDATE `lead_magnets` SET `published_at` = `created_at` WHERE `published_at` IS NULL AND json_extract(`formats`, '$.page') = 1;
