ALTER TABLE `leaderboard_feeds` ADD `pass_type_id` text;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `cert_expires_at` text;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `rate_limited_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `rate_limited_at` text;