CREATE TABLE `pathways` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`tier_prefix` text,
	`order` integer DEFAULT 0 NOT NULL,
	`founder_story` text,
	`tagline` text,
	`audience_promise` text,
	`promise_evidence` text,
	`source_ref` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pathways_user` ON `pathways` (`user_id`,`order`);--> statement-breakpoint
ALTER TABLE `goals` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `lead_magnets` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `library_assets` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `tier_code` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `tier_order` integer;--> statement-breakpoint
ALTER TABLE `offers` ADD `pathway_id` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `arc_stage` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `headline` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `current_situation` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `desired_situation` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `core_components` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `deliverables` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `one_liners` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `trust` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `get_started` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `obj_wrong_time` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `replaced_by_offer_id` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `source_ref` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `import_refs` text;