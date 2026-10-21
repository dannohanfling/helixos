ALTER TABLE `daily_logs` ADD `outreach_messages` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `scripts_written` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `videos_recorded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `videos_posted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `helix_ticks` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `ladder_tier` text;--> statement-breakpoint
-- Docket #10 (H-195): "Customer journey mapped" reads the Pathway, so it leads there; a link the coach changed is left alone.
UPDATE `helix_rungs` SET `href` = '/pathway' WHERE `key` = 'p2-journey' AND `href` = '/offers';
