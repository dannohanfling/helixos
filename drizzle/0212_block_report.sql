CREATE TABLE `member_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`blocker_membership_id` text NOT NULL,
	`blocked_membership_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_blocks_pair` ON `member_blocks` (`blocker_membership_id`,`blocked_membership_id`);--> statement-breakpoint
CREATE INDEX `member_blocks_blocked` ON `member_blocks` (`blocked_membership_id`);--> statement-breakpoint
ALTER TABLE `colosseum_wins` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `colosseum_wins` ADD `hidden_by` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `target_kind` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `target_id` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `target_user_id` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `handled_at` text;