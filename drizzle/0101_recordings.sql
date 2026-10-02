CREATE TABLE `fathom_workspace_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`last4` text DEFAULT '' NOT NULL,
	`last_validated_at` text,
	`last_error` text,
	`enabled_at` text NOT NULL,
	`webhook_id` text,
	`webhook_secret_encrypted` text,
	`webhook_registered_at` text,
	`last_sync_at` text,
	`last_sync_note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fathom_workspace_connections_ws` ON `fathom_workspace_connections` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `recording_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`item_index` integer NOT NULL,
	`text` text NOT NULL,
	`assignee_email` text,
	`state` text DEFAULT 'suggested' NOT NULL,
	`task_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_steps_rec_user_item` ON `recording_steps` (`recording_id`,`user_id`,`item_index`);--> statement-breakpoint
CREATE INDEX `recording_steps_user` ON `recording_steps` (`user_id`,`state`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`fathom_recording_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`share_url` text,
	`started_at` text,
	`ended_at` text,
	`summary` text,
	`action_items` text DEFAULT '[]' NOT NULL,
	`invitees` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`title_match` text DEFAULT 'none' NOT NULL,
	`note` text,
	`audience` text,
	`audience_user_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` text,
	`published_by` text,
	`transcript` text,
	`transcript_fetched_at` text,
	`transcript_hidden` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_ws_fathom` ON `recordings` (`workspace_id`,`fathom_recording_id`);--> statement-breakpoint
CREATE INDEX `recordings_ws_status` ON `recordings` (`workspace_id`,`status`,`started_at`);