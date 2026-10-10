CREATE TABLE `leaderboard_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`slug` text NOT NULL,
	`key_encrypted` text,
	`key_last4` text,
	`host` text DEFAULT 'https://www.eloyalty.ai' NOT NULL,
	`template_id` text,
	`hidden` text DEFAULT '[]' NOT NULL,
	`last_check_at` text,
	`last_check_ok` integer,
	`last_check_note` text,
	`cache_json` text,
	`cached_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_feeds_slug` ON `leaderboard_feeds` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_feeds_membership` ON `leaderboard_feeds` (`membership_id`);