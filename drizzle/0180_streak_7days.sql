ALTER TABLE `memberships` ADD `work_days` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `streak_recount_points` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `streak_recount_seen_at` text;