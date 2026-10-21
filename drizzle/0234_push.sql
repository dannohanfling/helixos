CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`install_id` text NOT NULL,
	`token` text,
	`app_version` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text DEFAULT (datetime('now')) NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_install` ON `push_devices` (`membership_id`,`install_id`);--> statement-breakpoint
CREATE INDEX `push_devices_member` ON `push_devices` (`membership_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `push_prefs` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`types` text DEFAULT '{}' NOT NULL,
	`quiet_start` integer DEFAULT 21 NOT NULL,
	`quiet_end` integer DEFAULT 7 NOT NULL,
	`asked_count` integer DEFAULT 0 NOT NULL,
	`asked_at` text,
	`answer` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_prefs_membership_id_unique` ON `push_prefs` (`membership_id`);--> statement-breakpoint
CREATE TABLE `push_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`key` text NOT NULL,
	`sent_at` text DEFAULT (datetime('now')) NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_sends_once` ON `push_sends` (`membership_id`,`type`,`key`);--> statement-breakpoint
CREATE INDEX `push_sends_day` ON `push_sends` (`membership_id`,`sent_at`);