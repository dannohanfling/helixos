CREATE TABLE `mf_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`webinar_id` text NOT NULL,
	`live` integer DEFAULT false NOT NULL,
	`prompt` text,
	`pillars` text DEFAULT '[]' NOT NULL,
	`agenda` text DEFAULT '[]' NOT NULL,
	`objections` text DEFAULT '[]' NOT NULL,
	`urgency` text DEFAULT '{"seatCap":null,"bonusDeadline":null,"bonusLine":"","liveOnly":false}' NOT NULL,
	`defaults` text DEFAULT '{"header":"","subheader":"","ctaLabel":"Save my seat, {first name}","whyYou":[],"exampleTitle":"","example":"","objection":{"objection":"","answer":""},"urgency":"","emotional":"","logical":"","ticketTitle":"","bring":[]}' NOT NULL,
	`proof_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mf_setups_webinar` ON `mf_setups` (`webinar_id`);--> statement-breakpoint
CREATE INDEX `mf_setups_member` ON `mf_setups` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `mf_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `mf_daily_cap` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `mf_domains` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `source` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `said` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `profile` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `pitch` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `pitch_sources` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `pitch_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `pitch_note` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `pitch_at` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `opened_at` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `registered_at` text;--> statement-breakpoint
ALTER TABLE `webinar_signups` ADD `registered_via` text;--> statement-breakpoint
UPDATE `webinar_signups` SET `registered_at` = `created_at`, `registered_via` = 'chat' WHERE `registered_at` IS NULL;