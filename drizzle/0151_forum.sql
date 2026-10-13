CREATE TABLE `forum_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`platform` text,
	`role` text,
	`link` text,
	`plot_id` text,
	`built_in` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`now` text,
	`last` text,
	`next` text,
	`flow_to` text,
	`flow_label` text,
	`flow_at` text,
	`queue` text DEFAULT '[]' NOT NULL,
	`created_by` text DEFAULT 'member' NOT NULL,
	`confirmed` integer DEFAULT true NOT NULL,
	`reported_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forum_agents_name` ON `forum_agents` (`workspace_id`,`user_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `forum_agents_member` ON `forum_agents` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `forum_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forum_events_member` ON `forum_events` (`workspace_id`,`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `forum_needs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text,
	`what` text NOT NULL,
	`detail` text,
	`when` text,
	`done_at` text,
	`done_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `forum_needs_member` ON `forum_needs` (`workspace_id`,`user_id`,`done_at`);--> statement-breakpoint
CREATE TABLE `forum_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`share_with_coach` integer DEFAULT false NOT NULL,
	`headline` text,
	`headline_at` text,
	`webhook_hash` text,
	`webhook_created_at` text,
	`webhook_used_at` text,
	`seeded_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forum_settings_member` ON `forum_settings` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `forum_settings_webhook` ON `forum_settings` (`webhook_hash`);