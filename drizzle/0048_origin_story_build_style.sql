ALTER TABLE `webinar_sections` ADD `build_style` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `webinars` ADD `stay_line` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `origin_story` text DEFAULT '{}' NOT NULL;