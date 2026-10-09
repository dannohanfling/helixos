CREATE TABLE `ladder_material` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`ladder_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_id` text NOT NULL,
	`tag` text NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`ladder_id`) REFERENCES `ladders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ladder_material_ladder` ON `ladder_material` (`ladder_id`);--> statement-breakpoint
CREATE INDEX `ladder_material_user` ON `ladder_material` (`user_id`,`used`);--> statement-breakpoint
CREATE TABLE `story_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`what` text NOT NULL,
	`exact_words` text,
	`numbers` text,
	`good_for` text,
	`status` text DEFAULT 'check' NOT NULL,
	`status_set_by` text,
	`raw_status` text,
	`source_call` text,
	`source_date` text,
	`fathom_url` text,
	`has_price` integer DEFAULT false NOT NULL,
	`digest` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_items_user_key` ON `story_items` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `story_items_user_status` ON `story_items` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `teaching_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`file` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`topic` text,
	`category` text,
	`taught_on` text,
	`call_type` text,
	`has_price` integer DEFAULT false NOT NULL,
	`digest` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_entries_user_key` ON `teaching_entries` (`user_id`,`key`);--> statement-breakpoint
CREATE VIRTUAL TABLE `teaching_fts` USING fts5(question, answer, topic, category, entry_id UNINDEXED, user_id UNINDEXED);--> statement-breakpoint
CREATE VIRTUAL TABLE `story_fts` USING fts5(title, what, exact_words, numbers, good_for, item_id UNINDEXED, user_id UNINDEXED);
