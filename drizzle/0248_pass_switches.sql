CREATE TABLE `pass_switches` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token` text NOT NULL,
	`from_customer_id` text NOT NULL,
	`status` text DEFAULT 'link' NOT NULL,
	`to_customer_id` text,
	`to_serial` text,
	`to_pass_type_id` text,
	`to_pass_url` text,
	`carry_points` integer,
	`carry_move_id` text,
	`last_note` text,
	`by_user_id` text NOT NULL,
	`made_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pass_switches_token` ON `pass_switches` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `pass_switches_member` ON `pass_switches` (`feed_id`,`from_customer_id`);--> statement-breakpoint
CREATE INDEX `pass_switches_feed` ON `pass_switches` (`feed_id`,`status`);