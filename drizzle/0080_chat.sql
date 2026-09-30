CREATE TABLE `chat_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`user_ns` text NOT NULL,
	`channel` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`linked_at` text,
	`unlinked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_links_token` ON `chat_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `chat_links_member` ON `chat_links` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `chat_progress_share` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `last_chat_push_at` text;