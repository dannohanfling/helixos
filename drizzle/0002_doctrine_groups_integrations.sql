CREATE TABLE `cert_deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`evidence_type` text,
	`pass_threshold` integer DEFAULT 85 NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `cert_modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cert_deliverables_module` ON `cert_deliverables` (`module_id`,`order`);--> statement-breakpoint
CREATE TABLE `cert_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`objective` text
);
--> statement-breakpoint
CREATE TABLE `cert_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`deliverable_id` text NOT NULL,
	`url` text,
	`notes` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`score` integer,
	`feedback` text,
	`reviewed_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cert_submissions_user` ON `cert_submissions` (`user_id`,`deliverable_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`program` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`order` integer DEFAULT 0 NOT NULL,
	`tier` text
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`kind` text DEFAULT 'member' NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`mission` text,
	`description` text,
	`audience` text,
	`admin_name` text,
	`admin_values` text,
	`rules` text,
	`posting_norms` text,
	`what_works` text,
	`member_count` integer,
	`posts_per_day` integer,
	`rating` integer,
	`last_posted_at` text,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `groups_user_kind` ON `groups` (`user_id`,`kind`,`rank`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`inbound_secret` text,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_ws_provider` ON `integrations` (`workspace_id`,`provider`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`completed_at` text DEFAULT (datetime('now')) NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_progress_user_lesson` ON `lesson_progress` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`objective` text,
	`prompts` text,
	`resources` text,
	`week` text,
	`stage_key` text,
	`points` integer DEFAULT 15 NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lessons_course` ON `lessons` (`course_id`,`order`);--> statement-breakpoint
CREATE TABLE `principles` (
	`code` text PRIMARY KEY NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`symbol` text,
	`greek_name` text,
	`name` text NOT NULL,
	`summary` text,
	`doctrine` text,
	`greek_story` text,
	`stoic_story` text,
	`business_case` text,
	`public_figure_story` text,
	`science_anchor` text,
	`personal_story` text,
	`client_story` text,
	`reel_script` text,
	`training_outline` text,
	`sales_positioning` text,
	`layer` text,
	`phase` text,
	`pillar` text,
	`hook_angle` text
);
--> statement-breakpoint
CREATE TABLE `proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'result' NOT NULL,
	`who` text,
	`problem_before` text,
	`shift` text,
	`result_after` text,
	`belief_broken` text DEFAULT 'none' NOT NULL,
	`short_version` text,
	`long_version` text,
	`hook` text,
	`punchline` text,
	`link` text,
	`client_record_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proofs_user` ON `proofs` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`direction` text NOT NULL,
	`event` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_events_ws` ON `sync_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`metric` text NOT NULL,
	`target` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `targets_user_month_metric` ON `targets` (`user_id`,`month`,`metric`);--> statement-breakpoint
DROP INDEX `variants_item_channel`;--> statement-breakpoint
ALTER TABLE `content_variants` ADD `group_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `variants_item_channel_group` ON `content_variants` (`content_item_id`,`channel`,`group_id`);--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `webinar_regs` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `webinar_shows` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `replay_views` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `applications` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `rev_content` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `rev_webinar` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `rev_dm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `proof_posts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `cta_posts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `belief_posts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `stories_created` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_logs` ADD `referral_asks` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `library_assets` ADD `extra` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cert_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_pass_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_pass_serial` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_pass_installed_at` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `eo_pass_last_push_at` text;