CREATE TABLE `loyalty_points_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`by_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`check_first` integer DEFAULT false NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_try_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_status` integer,
	`last_note` text,
	`event_id` text,
	`new_balance` integer,
	`sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loyalty_points_moves_source` ON `loyalty_points_moves` (`source`);--> statement-breakpoint
CREATE INDEX `loyalty_points_moves_feed` ON `loyalty_points_moves` (`feed_id`,`status`,`next_try_at`);--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `desk_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `moves_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `desk_check_at` text;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `desk_check_ok` integer;--> statement-breakpoint
ALTER TABLE `leaderboard_feeds` ADD `desk_check_note` text;