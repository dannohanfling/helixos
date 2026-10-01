PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_community_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`week_of` text,
	`month_of` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_community_shares`("id", "workspace_id", "user_id", "week_of", "created_at") SELECT "id", "workspace_id", "user_id", "week_of", "created_at" FROM `community_shares`;--> statement-breakpoint
DROP TABLE `community_shares`;--> statement-breakpoint
ALTER TABLE `__new_community_shares` RENAME TO `community_shares`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `community_shares_member_week` ON `community_shares` (`workspace_id`,`user_id`,`week_of`);--> statement-breakpoint
CREATE UNIQUE INDEX `community_shares_member_month` ON `community_shares` (`workspace_id`,`user_id`,`month_of`);--> statement-breakpoint
ALTER TABLE `community_posts` ADD `month_of` text;--> statement-breakpoint
CREATE UNIQUE INDEX `community_posts_month` ON `community_posts` (`workspace_id`,`kind`,`month_of`);--> statement-breakpoint
ALTER TABLE `community_settings` ADD `month_on` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `month_time` text DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `month_text` text;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `month_notify` integer DEFAULT true NOT NULL;