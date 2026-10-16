CREATE TABLE `hermes_contact_links` (
	`id` text PRIMARY KEY NOT NULL,
	`signup_id` text NOT NULL,
	`ghl_contact_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hermes_contact_links_signup` ON `hermes_contact_links` (`signup_id`);