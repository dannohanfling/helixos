CREATE TABLE `body_habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`habit_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_habit_logs_habit_date` ON `body_habit_logs` (`habit_id`,`date`);--> statement-breakpoint
CREATE INDEX `body_habit_logs_member_date` ON `body_habit_logs` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_habits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'done' NOT NULL,
	`unit` text,
	`target` real,
	`days` text DEFAULT '[]' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_habits_member` ON `body_habits` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_health` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`side` text,
	`started_on` text NOT NULL,
	`resolved_on` text,
	`movements` text,
	`restricted` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_health_member` ON `body_health` (`workspace_id`,`user_id`);