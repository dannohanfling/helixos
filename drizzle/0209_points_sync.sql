ALTER TABLE `leaderboard_feeds` ADD `sync_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `invite_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `invite_links` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_level_sent` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_offers_sent` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `points_ledger` ADD `eo_mirrored` integer DEFAULT false NOT NULL;