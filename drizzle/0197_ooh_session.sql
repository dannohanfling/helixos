ALTER TABLE `workspaces` ADD `ooh_weekday` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ooh_start` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `ooh_minutes` integer DEFAULT 60 NOT NULL;