CREATE TABLE `win_applause` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`win_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `win_applause_once` ON `win_applause` (`win_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `win_applause_win` ON `win_applause` (`workspace_id`,`win_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `applause_seen_at` text;