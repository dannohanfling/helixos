ALTER TABLE `ladders` ADD `source_type` text DEFAULT 'topic' NOT NULL;--> statement-breakpoint
ALTER TABLE `ladders` ADD `source_transcript` text;--> statement-breakpoint
ALTER TABLE `ladders` ADD `hook_options` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `ladders` ADD `on_screen_text` text;--> statement-breakpoint
ALTER TABLE `ladders` ADD `reel_flags` text DEFAULT '[]' NOT NULL;