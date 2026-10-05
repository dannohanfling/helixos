CREATE TABLE `body_exercise_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kept_id` text NOT NULL,
	`merged_id` text NOT NULL,
	`set_ids` text DEFAULT '[]' NOT NULL,
	`routines` text DEFAULT '[]' NOT NULL,
	`health` text DEFAULT '[]' NOT NULL,
	`kept_step` real,
	`undone_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_exercise_merges_member` ON `body_exercise_merges` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `body_exercise_merges_merged` ON `body_exercise_merges` (`merged_id`);