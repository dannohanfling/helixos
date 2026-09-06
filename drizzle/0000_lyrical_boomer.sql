CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text DEFAULT 'Facebook' NOT NULL,
	`profile_url` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`warmth` text DEFAULT 'warm' NOT NULL,
	`source` text,
	`what_theyre_building` text,
	`notes` text,
	`last_outbound_at` text,
	`last_inbound_at` text,
	`next_follow_up_at` text,
	`call_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_user_stage` ON `contacts` (`user_id`,`stage`);--> statement-breakpoint
CREATE INDEX `contacts_user_followup` ON `contacts` (`user_id`,`next_follow_up_at`);--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`content_type` text DEFAULT 'CTA Post' NOT NULL,
	`platform` text DEFAULT 'FB Group' NOT NULL,
	`has_cta` integer DEFAULT false NOT NULL,
	`hook` text,
	`body` text,
	`post_at` text,
	`posted_at` text,
	`post_link` text,
	`engagements` integer DEFAULT 0 NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`leads` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_user_status` ON `content_items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_user_post_at` ON `content_items` (`user_id`,`post_at`);--> statement-breakpoint
CREATE TABLE `curriculum_days` (
	`day` integer PRIMARY KEY NOT NULL,
	`week` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`instructions` text NOT NULL,
	`est_time` text,
	`points` integer DEFAULT 10 NOT NULL,
	`why` text
);
--> statement-breakpoint
CREATE TABLE `curriculum_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`day` integer NOT NULL,
	`completed_at` text DEFAULT (datetime('now')) NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_user_day` ON `curriculum_progress` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `daily_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`morning_done_at` text,
	`evening_done_at` text,
	`energy` integer,
	`intention` text,
	`dms_started` integer DEFAULT 0 NOT NULL,
	`conversations` integer DEFAULT 0 NOT NULL,
	`calls_booked` integer DEFAULT 0 NOT NULL,
	`calls_held` integer DEFAULT 0 NOT NULL,
	`posts` integer DEFAULT 0 NOT NULL,
	`offers_made` integer DEFAULT 0 NOT NULL,
	`new_leads` integer DEFAULT 0 NOT NULL,
	`cash_collected` real DEFAULT 0 NOT NULL,
	`start` text,
	`stop` text,
	`keep` text,
	`win` text,
	`gratitude` text,
	`streak_day` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_logs_user_date` ON `daily_logs` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `dm_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`name` text NOT NULL,
	`sequence` text NOT NULL,
	`step` integer DEFAULT 1 NOT NULL,
	`branch` text,
	`purpose` text,
	`body` text NOT NULL,
	`why_it_works` text,
	`when_to_send` text,
	`tokens` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`target` real NOT NULL,
	`actual` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT '$' NOT NULL,
	`period` text DEFAULT 'This month' NOT NULL,
	`due_date` text,
	`primary` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_tasks` (
	`key` text PRIMARY KEY NOT NULL,
	`stage_key` text NOT NULL,
	`order` integer NOT NULL,
	`name` text NOT NULL,
	`teaching` text,
	`how_to` text,
	`submission_type` text DEFAULT 'written' NOT NULL,
	`points` integer DEFAULT 10 NOT NULL,
	`effort` text DEFAULT 'medium' NOT NULL,
	`priority` text DEFAULT 'should' NOT NULL,
	`unlocks` text,
	`training_url` text,
	FOREIGN KEY (`stage_key`) REFERENCES `pathway_stages`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_stage` ON `library_tasks` (`stage_key`,`order`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`program_tier` text DEFAULT 'Academy' NOT NULL,
	`business_name` text,
	`big_promise` text,
	`reminder_hour` integer DEFAULT 8 NOT NULL,
	`evening_reminder_hour` integer DEFAULT 17 NOT NULL,
	`leaderboard_opt_in` integer DEFAULT true NOT NULL,
	`started_at` text DEFAULT (date('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_ws_user` ON `memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`user_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`template_id` text,
	`sent_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_contact` ON `messages` (`contact_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `pathway_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`library_task_key` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`submission_url` text,
	`submission_text` text,
	`coach_feedback` text,
	`submitted_at` text,
	`verified_at` text,
	`verified_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`library_task_key`) REFERENCES `library_tasks`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pathway_user_task` ON `pathway_progress` (`user_id`,`library_task_key`);--> statement-breakpoint
CREATE TABLE `pathway_stages` (
	`key` text PRIMARY KEY NOT NULL,
	`order` integer NOT NULL,
	`icon` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`track` text NOT NULL,
	`tagline` text,
	`description` text,
	`entry_criteria` text,
	`exit_criteria` text,
	`points_available` integer,
	`expected_duration` text,
	`runs_in_parallel` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `points_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`ref_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `points_user` ON `points_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `points_ref` ON `points_ledger` (`user_id`,`type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `reward_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reward_name` text NOT NULL,
	`points_spent` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`urgency` text DEFAULT 'medium' NOT NULL,
	`category` text DEFAULT 'sales' NOT NULL,
	`due_date` text,
	`focus_date` text,
	`completed_at` text,
	`points` integer DEFAULT 5 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`repeat_every_days` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_user_status` ON `tasks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_user_due` ON `tasks` (`user_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`avatar_emoji` text DEFAULT '🧭' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`brand_voice` text,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`client_invite_code` text NOT NULL,
	`coach_invite_code` text NOT NULL,
	`airtable_base_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_client_invite_code_unique` ON `workspaces` (`client_invite_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_coach_invite_code_unique` ON `workspaces` (`coach_invite_code`);