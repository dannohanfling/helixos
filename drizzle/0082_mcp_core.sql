CREATE TABLE `connected_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` text,
	`last_tool` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connected_apps_member` ON `connected_apps` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `mcp_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text NOT NULL,
	`tool` text NOT NULL,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	`ms` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_calls_app` ON `mcp_calls` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`client_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_challenge` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_codes_hash` ON `oauth_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_hash` ON `oauth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_app` ON `oauth_tokens` (`app_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `connected_apps_open` integer DEFAULT true NOT NULL;