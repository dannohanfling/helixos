CREATE TABLE `setup_steps` (
	`key` text PRIMARY KEY NOT NULL,
	`group` text NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	`href` text DEFAULT '/today' NOT NULL,
	`signal` text DEFAULT 'tick' NOT NULL,
	`needs` text DEFAULT '[]' NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`step_key` text NOT NULL,
	`by_user_id` text NOT NULL,
	`by_coach` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_ticks_member_step` ON `setup_ticks` (`workspace_id`,`user_id`,`step_key`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `start_here_watched_at` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `profile_saved_at` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `start_here_video` text;