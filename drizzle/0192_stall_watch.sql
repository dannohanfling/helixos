ALTER TABLE `forum_agents` ADD `stall_muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `forum_agents` ADD `stalled_at` text;--> statement-breakpoint
ALTER TABLE `forum_agents` ADD `stall_since` text;--> statement-breakpoint
ALTER TABLE `forum_agents` ADD `stall_need_id` text;--> statement-breakpoint
ALTER TABLE `forum_settings` ADD `stall_emails` integer DEFAULT false NOT NULL;