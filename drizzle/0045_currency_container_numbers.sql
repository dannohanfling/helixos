PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`avatar` text,
	`core_problem` text,
	`promise` text,
	`mechanism_name` text,
	`path_steps` text DEFAULT '[]' NOT NULL,
	`container` text DEFAULT '' NOT NULL,
	`length` text,
	`price` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`payment_plan` text,
	`guarantee` text,
	`scarcity` text,
	`urgency` text,
	`one_belief` text,
	`difference` text,
	`why_now` text,
	`why_trust` text,
	`how_it_works` text,
	`for_you_if` text,
	`not_for_you_if` text,
	`obj_time` text,
	`obj_money` text,
	`obj_partner` text,
	`obj_tried_before` text,
	`obj_diy` text,
	`objection_asset_ids` text DEFAULT '[]' NOT NULL,
	`sales_page_url` text,
	`payment_link` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_offers`("id", "workspace_id", "user_id", "name", "status", "avatar", "core_problem", "promise", "mechanism_name", "path_steps", "container", "length", "price", "payment_plan", "guarantee", "scarcity", "urgency", "one_belief", "difference", "why_now", "why_trust", "how_it_works", "for_you_if", "not_for_you_if", "obj_time", "obj_money", "obj_partner", "obj_tried_before", "obj_diy", "objection_asset_ids", "sales_page_url", "payment_link", "notes", "created_at") SELECT "id", "workspace_id", "user_id", "name", "status", "avatar", "core_problem", "promise", "mechanism_name", "path_steps", "container", "length", "price", "payment_plan", "guarantee", "scarcity", "urgency", "one_belief", "difference", "why_now", "why_trust", "how_it_works", "for_you_if", "not_for_you_if", "obj_time", "obj_money", "obj_partner", "obj_tried_before", "obj_diy", "objection_asset_ids", "sales_page_url", "payment_link", "notes", "created_at" FROM `offers`;--> statement-breakpoint
DROP TABLE `offers`;--> statement-breakpoint
ALTER TABLE `__new_offers` RENAME TO `offers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `offers_user` ON `offers` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_webinars` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`category` text DEFAULT 'Live' NOT NULL,
	`is_example` integer DEFAULT false NOT NULL,
	`audience` text,
	`core_problem` text,
	`desired_result` text,
	`promise` text,
	`mechanism_name` text,
	`mechanism_waived_reason` text,
	`presenter` text,
	`subject_ref` text,
	`offer_id` text,
	`cta_type` text DEFAULT 'Book a call' NOT NULL,
	`scheduled_at` text,
	`registration_url` text,
	`replay_url` text,
	`deck_url` text,
	`registered` integer,
	`showed` integer,
	`offers_made` integer,
	`calls_booked` integer,
	`sales` integer,
	`revenue` real,
	`debrief_leak` text,
	`debrief_fix` text,
	`debrief_wins` text,
	`notes` text,
	`updated_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_webinars`("id", "workspace_id", "user_id", "title", "status", "category", "is_example", "audience", "core_problem", "desired_result", "promise", "mechanism_name", "mechanism_waived_reason", "presenter", "subject_ref", "offer_id", "cta_type", "scheduled_at", "registration_url", "replay_url", "deck_url", "registered", "showed", "offers_made", "calls_booked", "sales", "revenue", "debrief_leak", "debrief_fix", "debrief_wins", "notes", "updated_at", "created_at") SELECT "id", "workspace_id", "user_id", "title", "status", "category", "is_example", "audience", "core_problem", "desired_result", "promise", "mechanism_name", "mechanism_waived_reason", "presenter", "subject_ref", "offer_id", "cta_type", "scheduled_at", "registration_url", "replay_url", "deck_url", "registered", "showed", "offers_made", "calls_booked", "sales", "revenue", "debrief_leak", "debrief_fix", "debrief_wins", "notes", "updated_at", "created_at" FROM `webinars`;--> statement-breakpoint
DROP TABLE `webinars`;--> statement-breakpoint
ALTER TABLE `__new_webinars` RENAME TO `webinars`;--> statement-breakpoint
CREATE INDEX `webinars_user` ON `webinars` (`user_id`,`status`);