CREATE TABLE `bot_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`last4` text NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_keys_hash` ON `bot_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `bot_keys_member` ON `bot_keys` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `webinar_signups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`first_name` text NOT NULL,
	`email` text NOT NULL,
	`contact_id` text,
	`cl_contact_id` text,
	`custom` text DEFAULT '{}' NOT NULL,
	`page_code` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webinar_signups_person` ON `webinar_signups` (`webinar_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `webinar_signups_page` ON `webinar_signups` (`page_code`);--> statement-breakpoint
CREATE INDEX `webinar_signups_member` ON `webinar_signups` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `booking_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `booking_expect` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `join_url` text;