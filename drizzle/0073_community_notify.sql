ALTER TABLE `community_posts` ADD `notify_all` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `monday_notify` integer DEFAULT true NOT NULL;