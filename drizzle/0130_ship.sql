ALTER TABLE `drip_handoffs` ADD `target` text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE `drip_handoffs` ADD `fb_post_id` text;--> statement-breakpoint
ALTER TABLE `drip_handoffs` ADD `ig_media_id` text;--> statement-breakpoint
ALTER TABLE `drip_handoffs` ADD `gap_minutes` integer;--> statement-breakpoint
ALTER TABLE `drip_handoffs` ADD `pin_last` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ladders` ADD `graphic_public_token` text;--> statement-breakpoint
ALTER TABLE `ladders` ADD `shipped_at` text;