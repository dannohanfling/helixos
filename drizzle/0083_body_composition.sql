CREATE TABLE `body_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`key` text NOT NULL,
	`value` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`reading_id` text NOT NULL,
	`time` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_daily_member_key_date` ON `body_daily` (`workspace_id`,`user_id`,`key`,`date`);--> statement-breakpoint
CREATE INDEX `body_daily_reading` ON `body_daily` (`reading_id`);--> statement-breakpoint
CREATE TABLE `body_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`target` real NOT NULL,
	`by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_goals_member_key` ON `body_goals` (`workspace_id`,`user_id`,`key`);