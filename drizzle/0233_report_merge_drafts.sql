ALTER TABLE `member_reports` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `done_draft` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `done_draft_by` text;--> statement-breakpoint
ALTER TABLE `member_reports` ADD `done_draft_at` text;--> statement-breakpoint
CREATE INDEX `member_reports_parent` ON `member_reports` (`parent_id`);--> statement-breakpoint
ALTER TABLE `report_messages` ADD `drafted_by` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_done_after_merge` integer DEFAULT false NOT NULL;