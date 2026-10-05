CREATE TABLE `recording_views` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`seen_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_views_rec_user` ON `recording_views` (`recording_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `recording_views_user` ON `recording_views` (`user_id`);