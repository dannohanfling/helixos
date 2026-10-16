ALTER TABLE `handoff_messages` ADD `hold_reason` text;--> statement-breakpoint
ALTER TABLE `handoff_messages` ADD `held_at` text;--> statement-breakpoint
ALTER TABLE `handoff_messages` ADD `superseded_by_id` text;