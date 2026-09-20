CREATE TABLE `brand_kits` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`ground` text NOT NULL,
	`ink` text NOT NULL,
	`accent` text NOT NULL,
	`muted` text NOT NULL,
	`surface` text NOT NULL,
	`inverse_ground` text,
	`inverse_ink` text,
	`display_font` text NOT NULL,
	`body_font` text NOT NULL,
	`quote_font` text,
	`font_fallback` text DEFAULT 'Arial' NOT NULL,
	`banned_colors` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brand_kits_workspace_id_unique` ON `brand_kits` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `webinars` ADD `presenter` text;--> statement-breakpoint
ALTER TABLE `webinars` ADD `subject_ref` text;