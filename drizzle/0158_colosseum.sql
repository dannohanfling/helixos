CREATE TABLE `colosseum_wins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `colosseum_wins_workspace` ON `colosseum_wins` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `arena_photo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `arena_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `arena_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `colosseum_on` integer DEFAULT false NOT NULL;