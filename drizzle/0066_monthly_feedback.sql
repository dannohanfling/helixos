CREATE TABLE `monthly_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`proud` text NOT NULL,
	`love` text NOT NULL,
	`less` text NOT NULL,
	`more` text NOT NULL,
	`wow` text NOT NULL,
	`referral_score` integer NOT NULL,
	`referral` text,
	`favorite` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_feedback_member_month` ON `monthly_feedback` (`workspace_id`,`user_id`,`month`);