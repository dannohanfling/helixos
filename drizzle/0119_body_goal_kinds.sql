ALTER TABLE `body_goals` ADD `kind` text DEFAULT 'scale' NOT NULL;--> statement-breakpoint
ALTER TABLE `body_goals` ADD `ref_id` text;--> statement-breakpoint
ALTER TABLE `body_goals` ADD `reps` integer;--> statement-breakpoint
ALTER TABLE `body_goals` ADD `start_value` real;--> statement-breakpoint
ALTER TABLE `body_goals` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `body_goals` ADD `archived_at` text;