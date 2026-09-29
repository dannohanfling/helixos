CREATE TABLE `body_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`author_user_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_comments_member_date` ON `body_comments` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_day_types` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`cal_min` real,
	`cal_max` real,
	`p_min` real,
	`p_max` real,
	`f_min` real,
	`f_max` real,
	`c_min` real,
	`c_max` real,
	`reminder` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_day_types_member` ON `body_day_types` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_days` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`day_type_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_days_member_date` ON `body_days` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`name` text NOT NULL,
	`meal_id` text,
	`items` text DEFAULT '[]' NOT NULL,
	`cal` real DEFAULT 0 NOT NULL,
	`p` real DEFAULT 0 NOT NULL,
	`f` real DEFAULT 0 NOT NULL,
	`c` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_entries_member_date` ON `body_entries` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_foods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text NOT NULL,
	`cal` real DEFAULT 0 NOT NULL,
	`p` real DEFAULT 0 NOT NULL,
	`f` real DEFAULT 0 NOT NULL,
	`c` real DEFAULT 0 NOT NULL,
	`cap_tag` text,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_foods_member` ON `body_foods` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slot` text,
	`items` text DEFAULT '[]' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_meals_member` ON `body_meals` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`share_with_coach` integer DEFAULT false NOT NULL,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`food_unit` text DEFAULT 'oz' NOT NULL,
	`cal_floor` real,
	`fat_floor` real,
	`over_ok` text DEFAULT '["p"]' NOT NULL,
	`week_pattern` text DEFAULT '{}' NOT NULL,
	`refeed_day_type_id` text,
	`refeed_anchor` text,
	`refeed_every_days` integer DEFAULT 14 NOT NULL,
	`meal_slots` text DEFAULT '["Breakfast","Lunch","Dinner","Snacks"]' NOT NULL,
	`caps` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_settings_member` ON `body_settings` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_share_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`shared` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_share_events_member` ON `body_share_events` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `body_enabled` integer DEFAULT false NOT NULL;