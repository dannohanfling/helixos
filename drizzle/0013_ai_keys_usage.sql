CREATE TABLE `ai_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`last4` text DEFAULT '' NOT NULL,
	`last_validated_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credentials_ws_user` ON `ai_credentials` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`feature` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_at` ON `ai_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_ws_at` ON `ai_usage` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `ai_cap_exempt` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ai_daily_cap` integer DEFAULT 40 NOT NULL;