CREATE TABLE `plan_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_kind` text DEFAULT 'record' NOT NULL,
	`to_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_links_pair` ON `plan_links` (`from_id`,`to_id`);
--> statement-breakpoint
CREATE INDEX `plan_links_user` ON `plan_links` (`workspace_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `plan_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`owner` text,
	`due_date` text,
	`notes` text,
	`pathway_stage` text,
	`order` integer DEFAULT 0 NOT NULL,
	`budget` real,
	`hire_trigger` text,
	`primary` integer DEFAULT false NOT NULL,
	`goal_id` text,
	`source_ref` text,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plan_records_user` ON `plan_records` (`workspace_id`,`user_id`,`kind`);