CREATE TABLE `social_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'gohighlevel' NOT NULL,
	`location_id` text NOT NULL,
	`ghl_user_id` text,
	`manual_token` text,
	`access_token` text,
	`token_expires_at` text,
	`accounts` text DEFAULT '[]' NOT NULL,
	`mapping` text DEFAULT '{}' NOT NULL,
	`connected_at` text,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_connections_user_provider` ON `social_connections` (`user_id`,`provider`);--> statement-breakpoint
ALTER TABLE `content_variants` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `content_variants` ADD `external_status` text;--> statement-breakpoint
ALTER TABLE `content_variants` ADD `external_error` text;--> statement-breakpoint
ALTER TABLE `content_variants` ADD `external_synced_at` text;