ALTER TABLE `brand_kits` ADD `spelling` text DEFAULT 'us' NOT NULL;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `legal_name` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `descriptor` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `descriptor_hidden` integer DEFAULT false NOT NULL;