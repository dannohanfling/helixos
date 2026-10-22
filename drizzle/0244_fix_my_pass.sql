ALTER TABLE `leaderboard_feeds` ADD `name_fix_proven` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `fix_names_on_change` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_name_needs_fix` integer DEFAULT false NOT NULL;