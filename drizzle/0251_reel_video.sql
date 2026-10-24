CREATE TABLE `media_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`blob_key` text NOT NULL,
	`blob_url` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`seconds` integer,
	`original_filename` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_videos_user` ON `media_videos` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ladders` ADD `video_id` text;