CREATE TABLE `bot_feature_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`feature_key` text NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL,
	`setup` text DEFAULT '{}' NOT NULL,
	`requested_at` text DEFAULT (datetime('now')) NOT NULL,
	`on_at` text,
	`on_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_feature_requests_member_key` ON `bot_feature_requests` (`workspace_id`,`user_id`,`feature_key`);--> statement-breakpoint
CREATE INDEX `bot_feature_requests_ws_state` ON `bot_feature_requests` (`workspace_id`,`state`);--> statement-breakpoint
CREATE TABLE `bot_feature_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`feature_key` text NOT NULL,
	`type` text NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_feature_rules_ws_key` ON `bot_feature_rules` (`workspace_id`,`feature_key`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_unlocks` text DEFAULT '[]' NOT NULL;