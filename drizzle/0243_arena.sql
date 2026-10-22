CREATE TABLE `arena_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`join_by` text NOT NULL,
	`timezone` text NOT NULL,
	`target_days` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_challenges_slug` ON `arena_challenges` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `arena_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`pod_id` text,
	`joined_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_entries_once` ON `arena_entries` (`challenge_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `arena_entries_user` ON `arena_entries` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `arena_huddle_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`huddle_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_huddle_checkins_once` ON `arena_huddle_checkins` (`huddle_id`,`membership_id`);--> statement-breakpoint
CREATE TABLE `arena_huddles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`starts_at` text NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `arena_huddles_once` ON `arena_huddles` (`challenge_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `arena_pods` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`name` text NOT NULL,
	`captain_membership_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arena_pods_challenge` ON `arena_pods` (`challenge_id`);