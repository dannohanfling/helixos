CREATE TABLE `deck_images` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`blob_key` text NOT NULL,
	`blob_url` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`caption` text,
	`consent_tick` integer DEFAULT false NOT NULL,
	`consent_name` text,
	`consent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deck_images_user` ON `deck_images` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deck_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`webinar_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`image_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_slots_key` ON `deck_slots` (`webinar_id`,`slot_key`);--> statement-breakpoint
ALTER TABLE `webinars` ADD `promise_line` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `chat_prompt` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `ground_rule` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `outcomes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `webinars` ADD `session_goal` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `permission_line` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `reflection_prompt` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `footer_bar` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `webinars` ADD `cta_bar` integer DEFAULT false NOT NULL;