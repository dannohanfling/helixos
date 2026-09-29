CREATE TABLE `coach_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`action` text,
	`page` text,
	`item` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coach_changes_client` ON `coach_changes` (`client_membership_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `coach_can_work` integer DEFAULT false NOT NULL;