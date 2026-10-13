CREATE TABLE `glossary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`heading` text NOT NULL,
	`term` text NOT NULL,
	`meaning` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `glossary_entries_slug` ON `glossary_entries` (`workspace_id`,`slug`);