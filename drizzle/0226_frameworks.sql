CREATE TABLE `frameworks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`pillar` text,
	`rank` text,
	`idea` text NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`when_to_use` text,
	`mistakes` text,
	`story` text,
	`exact_words` text,
	`source_call` text,
	`source_date` text,
	`fathom_url` text,
	`content_angles` text,
	`borrowed_from` text,
	`evolution` text,
	`raw_status` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`has_price` integer DEFAULT false NOT NULL,
	`digest` text NOT NULL,
	`published_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frameworks_workspace_slug` ON `frameworks` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `frameworks_workspace_status` ON `frameworks` (`workspace_id`,`status`);