ALTER TABLE `body_settings` ADD `ai_use` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `body_settings` ADD `ai_asked_at` text;--> statement-breakpoint
ALTER TABLE `body_share_events` ADD `kind` text DEFAULT 'coach' NOT NULL;