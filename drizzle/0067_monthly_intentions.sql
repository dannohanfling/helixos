CREATE TABLE `monthly_intentions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`word` text NOT NULL,
	`personal_season` text NOT NULL,
	`fear` text NOT NULL,
	`habit` text NOT NULL,
	`skill` text NOT NULL,
	`impact` text NOT NULL,
	`business_season` text NOT NULL,
	`revenue_goal` real NOT NULL,
	`revenue_why` text NOT NULL,
	`plan` text NOT NULL,
	`proud_last` text NOT NULL,
	`proud_end` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_intentions_member_month` ON `monthly_intentions` (`workspace_id`,`user_id`,`month`);