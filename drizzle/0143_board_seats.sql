CREATE TABLE `board_seats` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`owner_user_id` text,
	`areas` text DEFAULT '[]' NOT NULL,
	`card` text DEFAULT '' NOT NULL,
	`profile` text NOT NULL,
	`is_operator` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`real_person` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_seats_slug` ON `board_seats` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE INDEX `board_seats_owner` ON `board_seats` (`workspace_id`,`owner_user_id`);--> statement-breakpoint
ALTER TABLE `board_decisions` ADD `seats` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `board_council` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `expert_seats_live` integer DEFAULT false NOT NULL;