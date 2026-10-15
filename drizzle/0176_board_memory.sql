ALTER TABLE `board_decisions` ADD `remembered` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `board_decisions` ADD `example` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `board_fresh_start_at` text;