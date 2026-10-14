CREATE TABLE `helix_rungs` (
	`key` text PRIMARY KEY NOT NULL,
	`phase` integer NOT NULL,
	`order` integer NOT NULL,
	`label` text NOT NULL,
	`signal` text DEFAULT 'tick' NOT NULL,
	`href` text DEFAULT '/today' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `helix_ticks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`rung_key` text NOT NULL,
	`by_user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `helix_ticks_member_rung` ON `helix_ticks` (`workspace_id`,`user_id`,`rung_key`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `helix_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `helix_seen` text DEFAULT '[]' NOT NULL;