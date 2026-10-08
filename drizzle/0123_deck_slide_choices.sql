CREATE TABLE `deck_slide_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`webinar_id` text NOT NULL,
	`slide_key` text NOT NULL,
	`layout` text,
	`accent_phrase` text,
	`accent_off` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_slide_choices_key` ON `deck_slide_choices` (`webinar_id`,`slide_key`);