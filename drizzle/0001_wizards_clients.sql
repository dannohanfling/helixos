CREATE TABLE `client_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`client_record_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text DEFAULT 'checkin' NOT NULL,
	`wins` text,
	`blockers` text,
	`support_needed` text,
	`next_step` text,
	`mindset` integer,
	`energy` integer,
	`business` integer,
	`cash_collected` real DEFAULT 0 NOT NULL,
	`nps` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`client_record_id`) REFERENCES `client_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_checkins_client` ON `client_checkins` (`client_record_id`,`date`);--> statement-breakpoint
CREATE TABLE `client_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`avatar_emoji` text DEFAULT '🙂' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`offer_id` text,
	`program_name` text,
	`start_date` text,
	`end_date` text,
	`goal_90` text,
	`fear` text,
	`roadblock` text,
	`phase` text,
	`checkin_cadence_days` integer DEFAULT 7 NOT NULL,
	`next_call_at` text,
	`last_checkin_at` text,
	`notes` text,
	`contact_id` text,
	`pass_serial` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `client_records_user` ON `client_records` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `content_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`content_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel` text NOT NULL,
	`body` text NOT NULL,
	`subject` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`post_at` text,
	`posted_at` text,
	`post_url` text,
	`reactions` integer DEFAULT 0 NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`dms` integer DEFAULT 0 NOT NULL,
	`leads` integer DEFAULT 0 NOT NULL,
	`generated_by` text DEFAULT 'rules' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_item_channel` ON `content_variants` (`content_item_id`,`channel`);--> statement-breakpoint
CREATE TABLE `library_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`user_id` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`summary` text,
	`use_when` text,
	`tag` text,
	`reframe` text,
	`proof` text,
	`is_example` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_type` ON `library_assets` (`type`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `member_points` (
	`id` text PRIMARY KEY NOT NULL,
	`client_record_id` text NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`sync_status` text DEFAULT 'local' NOT NULL,
	`sync_note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`client_record_id`) REFERENCES `client_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_points_client` ON `member_points` (`client_record_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `offer_components` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'core' NOT NULL,
	`description` text,
	`perceived_value` real DEFAULT 0 NOT NULL,
	`order` integer DEFAULT 1 NOT NULL,
	`problem_it_solves` text,
	`belief_break` text DEFAULT 'none' NOT NULL,
	`one_liner` text,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offer_components_offer` ON `offer_components` (`offer_id`,`order`);--> statement-breakpoint
CREATE TABLE `offers` (
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
	`container` text DEFAULT 'Group program' NOT NULL,
	`length` text,
	`price` real DEFAULT 0 NOT NULL,
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
	`sales_page_url` text,
	`payment_link` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `offers_user` ON `offers` (`user_id`);--> statement-breakpoint
CREATE TABLE `readiness_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`webinar_id` text NOT NULL,
	`ratings` text DEFAULT '{}' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`verdict` text DEFAULT 'not_ready' NOT NULL,
	`biggest_gaps` text,
	`next_actions` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webinar_beliefs` (
	`id` text PRIMARY KEY NOT NULL,
	`webinar_id` text NOT NULL,
	`type` text NOT NULL,
	`from_belief` text,
	`to_belief` text,
	`proof` text,
	`story_asset_id` text,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webinar_beliefs_type` ON `webinar_beliefs` (`webinar_id`,`type`);--> statement-breakpoint
CREATE TABLE `webinar_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`webinar_id` text NOT NULL,
	`section_key` text NOT NULL,
	`act` text NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`key_points` text,
	`script` text,
	`transition_in` text,
	`transition_out` text,
	`asset_id` text,
	`duration_min` integer DEFAULT 4 NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	FOREIGN KEY (`webinar_id`) REFERENCES `webinars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webinar_sections_key` ON `webinar_sections` (`webinar_id`,`section_key`);--> statement-breakpoint
CREATE TABLE `webinars` (
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
	`offer_id` text,
	`cta_type` text DEFAULT 'Book a call' NOT NULL,
	`scheduled_at` text,
	`registration_url` text,
	`replay_url` text,
	`deck_url` text,
	`registered` integer DEFAULT 0 NOT NULL,
	`showed` integer DEFAULT 0 NOT NULL,
	`offers_made` integer DEFAULT 0 NOT NULL,
	`calls_booked` integer DEFAULT 0 NOT NULL,
	`sales` integer DEFAULT 0 NOT NULL,
	`revenue` real DEFAULT 0 NOT NULL,
	`debrief_leak` text,
	`debrief_fix` text,
	`debrief_wins` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webinars_user` ON `webinars` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_name` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_webhook_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_hashtag` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `pass_community_url` text;