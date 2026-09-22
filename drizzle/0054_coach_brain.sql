CREATE TABLE `faq_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`question` text NOT NULL,
	`also_asked` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`answer` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT 'ai_unreviewed' NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`times_asked` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faq_entries_owner` ON `faq_entries` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `faq_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`field_name` text NOT NULL,
	`budget` integer NOT NULL,
	`chars` integer NOT NULL,
	`entry_count` integer NOT NULL,
	`dropped` text DEFAULT '[]' NOT NULL,
	`snapshot` text DEFAULT '[]' NOT NULL,
	`value_read_back` integer DEFAULT false NOT NULL,
	`token_read_back` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`sent_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faq_syncs_owner` ON `faq_syncs` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_agent_ns` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `faq_bot_field` text;