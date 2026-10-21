CREATE TABLE `report_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`report_id` text NOT NULL,
	`user_id` text NOT NULL,
	`by_user_id` text,
	`kind` text NOT NULL,
	`status` text,
	`body` text NOT NULL,
	`emailed` integer DEFAULT false NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `report_messages_report` ON `report_messages` (`report_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `report_messages_user` ON `report_messages` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `member_reports` ADD `status` text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `topic` text;--> statement-breakpoint
-- H-202: reports already answered keep where they stood: Done ones Done, seen ones Seen.
UPDATE `member_reports` SET `status` = 'done' WHERE `done_at` IS NOT NULL;--> statement-breakpoint
UPDATE `member_reports` SET `status` = 'seen' WHERE `done_at` IS NULL AND `seen_at` IS NOT NULL;
