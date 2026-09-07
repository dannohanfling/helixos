CREATE TABLE `coach_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`author_user_id` text NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coach_notes_membership` ON `coach_notes` (`membership_id`,`date`);--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `booked_at` text;--> statement-breakpoint
ALTER TABLE `reward_claims` ADD `booked_ref` text;