CREATE TABLE `schedule_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`job_key` text NOT NULL,
	`name` text NOT NULL,
	`when_text` text DEFAULT '' NOT NULL,
	`last_status` text,
	`last_reason` text,
	`last_at` text,
	`next_at` text,
	`needs_you` integer DEFAULT false NOT NULL,
	`hidden_at` text,
	`via` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_jobs_key` ON `schedule_jobs` (`workspace_id`,`user_id`,`agent_id`,`job_key`);--> statement-breakpoint
ALTER TABLE `forum_events` ADD `via` text;--> statement-breakpoint
ALTER TABLE `handoff_messages` ADD `via` text;