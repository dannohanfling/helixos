CREATE TABLE `ghl_media` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`location_id` text NOT NULL,
	`source` text NOT NULL,
	`ghl_file_id` text NOT NULL,
	`url` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ghl_media_source` ON `ghl_media` (`workspace_id`,`user_id`,`location_id`,`source`);--> statement-breakpoint
ALTER TABLE `social_connections` ADD `media_scope_missing_at` text;