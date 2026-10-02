CREATE TABLE `body_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`monday` text NOT NULL,
	`lines` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_checkins_member_week` ON `body_checkins` (`workspace_id`,`user_id`,`monday`);--> statement-breakpoint
CREATE TABLE `body_template_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`coach_name` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`decided_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_template_sends_member` ON `body_template_sends` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `body_template_sends_coach` ON `body_template_sends` (`workspace_id`,`coach_user_id`);