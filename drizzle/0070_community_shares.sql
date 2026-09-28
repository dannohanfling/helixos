CREATE TABLE `community_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`week_of` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_shares_member_week` ON `community_shares` (`workspace_id`,`user_id`,`week_of`);