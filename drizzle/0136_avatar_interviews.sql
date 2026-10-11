CREATE TABLE `avatar_interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`avatar_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`turns` text DEFAULT '[]' NOT NULL,
	`draft` text,
	`saved_avatar_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `avatar_interviews_member` ON `avatar_interviews` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `avatar_interviews_saved` ON `avatar_interviews` (`saved_avatar_id`);