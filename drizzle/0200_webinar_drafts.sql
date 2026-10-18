CREATE TABLE `webinar_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`step` text NOT NULL,
	`section_key` text DEFAULT '' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	`by_label` text NOT NULL,
	`app_id` text,
	`agent_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webinar_drafts_webinar` ON `webinar_drafts` (`webinar_id`,`status`);--> statement-breakpoint
CREATE INDEX `webinar_drafts_member` ON `webinar_drafts` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `webinar_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`draft_id` text,
	`step` text,
	`section_key` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`by_label` text NOT NULL,
	`by_connector` integer DEFAULT false NOT NULL,
	`changed` text DEFAULT '[]' NOT NULL,
	`before` text,
	`undone_at` text,
	`undone_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webinar_history_webinar` ON `webinar_history` (`webinar_id`,`created_at`);