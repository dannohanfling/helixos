CREATE TABLE `drip_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`ladder_id` text NOT NULL,
	`handed_at` text NOT NULL,
	`rung_count` integer NOT NULL,
	`threads_at` text,
	`expires_at` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drip_handoffs_user` ON `drip_handoffs` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `drip_handoffs_item` ON `drip_handoffs` (`content_item_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_drip_webhook_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_user_ns` text;