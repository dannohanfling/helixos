CREATE TABLE `weekly_intentions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`week_of` text NOT NULL,
	`word` text NOT NULL,
	`key_results` text DEFAULT '[]' NOT NULL,
	`initiative` text NOT NULL,
	`tasks` text DEFAULT '[]' NOT NULL,
	`reviewed_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_intentions_member_week` ON `weekly_intentions` (`workspace_id`,`user_id`,`week_of`);