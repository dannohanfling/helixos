CREATE TABLE `board_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`question` text NOT NULL,
	`mode` text DEFAULT 'board' NOT NULL,
	`focus` text,
	`preset` text DEFAULT 'standard' NOT NULL,
	`answer` text,
	`notes` text DEFAULT '[]' NOT NULL,
	`used` text DEFAULT '[]' NOT NULL,
	`proposals` text DEFAULT '[]' NOT NULL,
	`applied` text DEFAULT '[]' NOT NULL,
	`step_tasks` text DEFAULT '[]' NOT NULL,
	`checkins` text DEFAULT '[]' NOT NULL,
	`shared_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `board_decisions_member` ON `board_decisions` (`workspace_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `board_decisions_parent` ON `board_decisions` (`parent_id`);--> statement-breakpoint
CREATE TABLE `board_principles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`good_for` text DEFAULT '' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `board_principles_ws` ON `board_principles` (`workspace_id`,`order`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `board_hours` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `board_sees_body` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `board_preset` text DEFAULT 'standard' NOT NULL;