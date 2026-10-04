CREATE TABLE `form_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`data` text NOT NULL,
	`sent` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_drafts_user_key` ON `form_drafts` (`user_id`,`key`);