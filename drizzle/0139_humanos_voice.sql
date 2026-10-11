CREATE TABLE `body_feelings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`energy` integer,
	`mood` integer,
	`soreness` text,
	`soreness_area` text,
	`sleep_feel` integer,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_feelings_member_date` ON `body_feelings` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `body_activities` ADD `intensity` text;--> statement-breakpoint
ALTER TABLE `body_sets` ADD `note` text;--> statement-breakpoint
ALTER TABLE `body_sets` ADD `warmup` integer DEFAULT false NOT NULL;