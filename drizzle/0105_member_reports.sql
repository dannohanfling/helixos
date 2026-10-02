CREATE TABLE `member_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`page` text,
	`question` text,
	`answer` text,
	`talk_to_coach` integer DEFAULT false NOT NULL,
	`screenshot_key` text,
	`screenshot_url` text,
	`screenshot_type` text,
	`seen_at` text,
	`done_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_reports_ws_created` ON `member_reports` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_reports_user` ON `member_reports` (`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `feedback_seen_at` text;