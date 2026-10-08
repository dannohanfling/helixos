ALTER TABLE `brand_kits` ADD `ai_backgrounds` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `deck_images` ADD `source` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `ladders` ADD `graphic_image_id` text;--> statement-breakpoint
ALTER TABLE `ladders` ADD `graphic_options` text;