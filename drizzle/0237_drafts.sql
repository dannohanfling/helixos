CREATE TABLE `change_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`area` text NOT NULL,
	`target_id` text,
	`draft_id` text,
	`action` text NOT NULL,
	`by_label` text NOT NULL,
	`by_connector` integer DEFAULT false NOT NULL,
	`changed` text DEFAULT '[]' NOT NULL,
	`before` text,
	`undone_at` text,
	`undone_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_history_target` ON `change_history` (`area`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `change_history_member` ON `change_history` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`area` text NOT NULL,
	`target_id` text,
	`fields` text DEFAULT '{}' NOT NULL,
	`base` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	`by_label` text NOT NULL,
	`app_id` text,
	`agent_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drafts_member` ON `drafts` (`workspace_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `drafts_target` ON `drafts` (`area`,`target_id`);