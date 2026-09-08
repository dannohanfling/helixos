CREATE TABLE `socrates_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`workspace_id` text,
	`user_id` text,
	`question` text NOT NULL,
	`clarity_stage` text NOT NULL,
	`nepq_category` text,
	`source` text DEFAULT 'Mine' NOT NULL,
	`script_types` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `socrates_questions_key` ON `socrates_questions` (`key`);--> statement-breakpoint
CREATE INDEX `socrates_questions_owner` ON `socrates_questions` (`user_id`);--> statement-breakpoint
CREATE TABLE `socrates_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`script_type` text DEFAULT 'High-Ticket Sales Call' NOT NULL,
	`beats` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `socrates_scripts_owner` ON `socrates_scripts` (`user_id`,`updated_at`);