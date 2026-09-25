CREATE TABLE `office_hours_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`friday` text NOT NULL,
	`description` text NOT NULL,
	`tried_self` text NOT NULL,
	`tools` text,
	`goal` text NOT NULL,
	`category` text NOT NULL,
	`responsible` text,
	`outcome` text,
	`coach_notes` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `office_hours_requests_ws_friday` ON `office_hours_requests` (`workspace_id`,`friday`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ooh_categories` text DEFAULT '["Chatbot","Airtable","Funnels","FB Group Management","Offer Creation","Other"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ooh_hosts` text DEFAULT '["Danno Hanfling","Shonna Roadruck"]' NOT NULL;