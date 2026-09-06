CREATE TABLE `library_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`user_id` text,
	`kind` text DEFAULT 'post' NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`content_type` text,
	`pillar` text,
	`angle` text,
	`hook` text,
	`body` text DEFAULT '' NOT NULL,
	`cta` text,
	`has_cta` integer DEFAULT false NOT NULL,
	`use_when` text,
	`why_it_works` text,
	`example` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'master' NOT NULL,
	`source_content_id` text,
	`engagements` integer DEFAULT 0 NOT NULL,
	`leads` integer DEFAULT 0 NOT NULL,
	`used_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_posts_scope` ON `library_posts` (`workspace_id`,`user_id`,`kind`);