ALTER TABLE `memberships` ADD `ooh_notice` text;--> statement-breakpoint
ALTER TABLE `office_hours_requests` ADD `submitted_by_user_id` text;--> statement-breakpoint
ALTER TABLE `office_hours_requests` ADD `attendee_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `office_hours_requests` ADD `attendees_other` text;