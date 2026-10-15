CREATE TABLE `mf_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`code` text NOT NULL,
	`first_name` text DEFAULT '' NOT NULL,
	`pitch` text NOT NULL,
	`sources` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mf_previews_code` ON `mf_previews` (`code`);--> statement-breakpoint
CREATE INDEX `mf_previews_member` ON `mf_previews` (`workspace_id`,`user_id`);