ALTER TABLE `office_hours_requests` ADD `airtable_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `office_hours_requests_airtable` ON `office_hours_requests` (`workspace_id`,`airtable_id`);