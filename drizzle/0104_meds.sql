CREATE TABLE `body_med_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`med_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_med_logs_dose` ON `body_med_logs` (`med_id`,`date`,`slot`);--> statement-breakpoint
CREATE INDEX `body_med_logs_member_date` ON `body_med_logs` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_meds` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'supplement' NOT NULL,
	`dose` text,
	`how_taken` text,
	`times_per_day` integer DEFAULT 1 NOT NULL,
	`days` text DEFAULT '[]' NOT NULL,
	`with_food` text,
	`note` text,
	`per_dose` real DEFAULT 1 NOT NULL,
	`unit_word` text,
	`on_hand` real,
	`boxed_until` text,
	`supply_days` integer,
	`repeats_left` integer,
	`last_filled_on` text,
	`issued_on` text,
	`expires_on` text,
	`script_kind` text,
	`refill_rule` text DEFAULT 'before_runout' NOT NULL,
	`refill_days` integer DEFAULT 12 NOT NULL,
	`refill_share` integer DEFAULT 75 NOT NULL,
	`remind_days` integer DEFAULT 5 NOT NULL,
	`remind_on` text DEFAULT 'runout' NOT NULL,
	`pharmacy` text,
	`prescriber` text,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_meds_member` ON `body_meds` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `body_settings` ADD `meds_share` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `body_settings` ADD `meds_ai` integer DEFAULT false NOT NULL;