CREATE TABLE `hermes_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`host_on` integer DEFAULT false NOT NULL,
	`video_url` text,
	`pixel_id` text,
	`pixel_on` integer DEFAULT false NOT NULL,
	`ghl_failed` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_pages_webinar` ON `hermes_pages` (`webinar_id`);--> statement-breakpoint
CREATE INDEX `hermes_pages_member` ON `hermes_pages` (`workspace_id`,`user_id`);