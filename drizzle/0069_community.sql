CREATE TABLE `community_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`week_of` text,
	`title` text NOT NULL,
	`body` text,
	`account_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`ghl_post_id` text,
	`platform_post_id` text,
	`link` text,
	`error` text,
	`author_shown` text,
	`sent_at` text,
	`posted_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_posts_week` ON `community_posts` (`workspace_id`,`kind`,`week_of`);--> statement-breakpoint
CREATE INDEX `community_posts_workspace` ON `community_posts` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `community_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`channel_account_id` text,
	`channel_name` text,
	`monday_on` integer DEFAULT false NOT NULL,
	`post_time` text DEFAULT '08:00' NOT NULL,
	`monday_text` text,
	`post_as_id` text,
	`post_as_name` text,
	`link_pattern` text,
	`paused_reason` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_settings_workspace` ON `community_settings` (`workspace_id`);