CREATE TABLE `body_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'weight' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_exercises_member` ON `body_exercises` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`day_type_id` text,
	`items` text DEFAULT '[]' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_routines_member` ON `body_routines` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`routine_id` text,
	`routine_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_sessions_member_date` ON `body_sessions` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`date` text NOT NULL,
	`weight` real,
	`unit` text DEFAULT 'lb' NOT NULL,
	`reps` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_sets_member_exercise` ON `body_sets` (`workspace_id`,`user_id`,`exercise_id`,`date`);--> statement-breakpoint
CREATE INDEX `body_sets_session` ON `body_sets` (`session_id`);--> statement-breakpoint
ALTER TABLE `body_days` ADD `off` integer DEFAULT false NOT NULL;