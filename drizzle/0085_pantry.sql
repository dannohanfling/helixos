CREATE TABLE `body_pantry` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`qty` real NOT NULL,
	`unit` text NOT NULL,
	`state` text DEFAULT 'raw' NOT NULL,
	`location` text DEFAULT 'fridge' NOT NULL,
	`bought_on` text,
	`use_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_pantry_member` ON `body_pantry` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `body_pantry_food` ON `body_pantry` (`food_id`);--> statement-breakpoint
CREATE TABLE `body_yields` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`food_id` text NOT NULL,
	`raw` real NOT NULL,
	`cooked` real NOT NULL,
	`unit` text NOT NULL,
	`date` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_yields_food` ON `body_yields` (`workspace_id`,`user_id`,`food_id`);--> statement-breakpoint
ALTER TABLE `body_foods` ADD `basis` text DEFAULT 'cooked' NOT NULL;--> statement-breakpoint
ALTER TABLE `body_foods` ADD `par` real;--> statement-breakpoint
ALTER TABLE `body_foods` ADD `cooked_yield` real;