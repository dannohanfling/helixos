CREATE TABLE `headshot_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`airtable_record_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`email` text,
	`reason` text NOT NULL,
	`candidates` text DEFAULT '[]' NOT NULL,
	`photo_url` text,
	`photo_display_url` text,
	`mime` text,
	`status` text DEFAULT 'open' NOT NULL,
	`picked_membership_id` text,
	`resolved_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `headshot_reviews_attachment` ON `headshot_reviews` (`workspace_id`,`attachment_id`);--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_use_headshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_display_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_mime` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_source` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_airtable_id` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `headshot_updated_at` text;