CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`app_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`last4` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_owner` ON `agent_tokens` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `handoff_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`checkins` integer DEFAULT false NOT NULL,
	`every_minutes` integer DEFAULT 60 NOT NULL,
	`active_from` text DEFAULT '07:00' NOT NULL,
	`active_to` text DEFAULT '19:00' NOT NULL,
	`active_days` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`tz` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`session_url` text,
	`busy_note` text,
	`busy_since` text,
	`last_checkin_at` text,
	`last_act` text,
	`count_day` text,
	`count_today` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_agents_agent` ON `handoff_agents` (`workspace_id`,`user_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `handoff_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text,
	`action` text NOT NULL,
	`ref` text,
	`note` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `handoff_audit_owner` ON `handoff_audit` (`workspace_id`,`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `handoff_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`recipient` text NOT NULL,
	`delivered_at` text,
	`acked_at` text,
	`ack_note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_deliveries_once` ON `handoff_deliveries` (`message_id`,`recipient`);--> statement-breakpoint
CREATE INDEX `handoff_deliveries_recipient` ON `handoff_deliveries` (`recipient`,`delivered_at`);--> statement-breakpoint
CREATE TABLE `handoff_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`agent_id` text,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`ready_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_files_key` ON `handoff_files` (`key`);--> statement-breakpoint
CREATE INDEX `handoff_files_owner` ON `handoff_files` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `handoff_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`from_agent_id` text,
	`to_ids` text DEFAULT '[]' NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`reply_to_id` text,
	`thread_id` text,
	`file_ids` text DEFAULT '[]' NOT NULL,
	`needs_approval` integer DEFAULT false NOT NULL,
	`approval_reasons` text DEFAULT '[]' NOT NULL,
	`claims_approval` integer DEFAULT false NOT NULL,
	`decision` text,
	`decision_note` text,
	`decided_at` text,
	`decided_by` text,
	`decision_for_id` text,
	`urgent` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handoff_messages_seq` ON `handoff_messages` (`workspace_id`,`user_id`,`seq`);--> statement-breakpoint
CREATE INDEX `handoff_messages_thread` ON `handoff_messages` (`thread_id`);--> statement-breakpoint
ALTER TABLE `connected_apps` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `forum_settings` ADD `approval_emails` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `forum_settings` ADD `checkins_paused` integer DEFAULT false NOT NULL;