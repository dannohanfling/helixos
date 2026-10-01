CREATE TABLE `body_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lines` text DEFAULT '[]' NOT NULL,
	`link` text,
	`status` text DEFAULT 'link' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_orders_member` ON `body_orders` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `body_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`monday` text NOT NULL,
	`meal_id` text NOT NULL,
	`times` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_plan_member_week_meal` ON `body_plan` (`workspace_id`,`user_id`,`monday`,`meal_id`);--> statement-breakpoint
ALTER TABLE `body_foods` ADD `section` text;