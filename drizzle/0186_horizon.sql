CREATE TABLE `horizon_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`line` text NOT NULL,
	`area` text NOT NULL,
	`status` text NOT NULL,
	`from_feedback` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`shipped_at` text,
	`menu_key` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `horizon_items_ws` ON `horizon_items` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `horizon_wants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`notified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `horizon_wants_member_item` ON `horizon_wants` (`workspace_id`,`user_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `horizon_wants_item` ON `horizon_wants` (`item_id`);