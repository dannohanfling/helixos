CREATE TABLE `leaderboard_slug_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_slug_aliases_slug` ON `leaderboard_slug_aliases` (`slug`);--> statement-breakpoint
CREATE INDEX `leaderboard_slug_aliases_feed` ON `leaderboard_slug_aliases` (`feed_id`);