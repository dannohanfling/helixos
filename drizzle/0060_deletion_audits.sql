CREATE TABLE `deletion_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`ran_by_user_id` text NOT NULL,
	`deleted_email` text NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`objects` integer DEFAULT 0 NOT NULL,
	`user_removed` integer DEFAULT false NOT NULL,
	`workspace_removed` integer DEFAULT false NOT NULL,
	`stopped_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
