CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`claim` text NOT NULL,
	`asked_for` text NOT NULL,
	`title` text NOT NULL,
	`authors` text DEFAULT '' NOT NULL,
	`year` integer,
	`doi` text,
	`url` text,
	`openalex_id` text,
	`cited_by_count` integer DEFAULT 0 NOT NULL,
	`citation_quality` text DEFAULT 'unverified' NOT NULL,
	`flags` text DEFAULT '[]' NOT NULL,
	`verified_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_owner` ON `evidence` (`user_id`);--> statement-breakpoint
CREATE TABLE `evidence_hidden` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`shared_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_hidden_user_shared` ON `evidence_hidden` (`user_id`,`shared_id`);--> statement-breakpoint
CREATE TABLE `evidence_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`query_key` text NOT NULL,
	`query` text NOT NULL,
	`claim` text DEFAULT '' NOT NULL,
	`asked_for` text NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`from_cache` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evidence_searches_user_day` ON `evidence_searches` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `evidence_searches_key` ON `evidence_searches` (`query_key`);--> statement-breakpoint
CREATE TABLE `evidence_shared` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`authors_source` text NOT NULL,
	`category` text NOT NULL,
	`confidence_level` text NOT NULL,
	`short_summary` text NOT NULL,
	`why_it_matters` text NOT NULL,
	`fifteen_second_script` text NOT NULL,
	`thirty_second_reel_script` text NOT NULL,
	`clip_hook` text NOT NULL,
	`supports` text DEFAULT '[]' NOT NULL,
	`doi` text NOT NULL,
	`url` text NOT NULL,
	`openalex_id` text NOT NULL,
	`citation_quality` text NOT NULL,
	`verified_title` text NOT NULL,
	`verified_year` integer NOT NULL,
	`cited_by_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `content_variants` ADD `notes` text;