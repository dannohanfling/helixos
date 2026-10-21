ALTER TABLE `memberships` ADD `tools_phase` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `tools_announced` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `show_all_tools` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `helix_pct` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Everyone here before tools opened by phase keeps every tool (H-164 §12): nothing anyone used goes away. New members start at phase 0.
UPDATE `memberships` SET `show_all_tools` = 1;
