CREATE TABLE `email_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`new_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`started_by` text NOT NULL,
	`old_masked` text NOT NULL,
	`new_masked` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_changes_token_hash_unique` ON `email_changes` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_changes_user` ON `email_changes` (`user_id`);