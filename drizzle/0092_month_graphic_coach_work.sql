PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`program_tier` text DEFAULT 'Academy' NOT NULL,
	`business_name` text,
	`big_promise` text,
	`audience` text,
	`emails_enabled` integer DEFAULT true NOT NULL,
	`reminder_hour` integer DEFAULT 8 NOT NULL,
	`evening_reminder_hour` integer DEFAULT 17 NOT NULL,
	`leaderboard_opt_in` integer DEFAULT true NOT NULL,
	`started_at` text DEFAULT (date('now')) NOT NULL,
	`pass_enabled` integer DEFAULT false NOT NULL,
	`pass_name` text,
	`pass_url` text,
	`pass_webhook_url` text,
	`pass_hashtag` text,
	`pass_community_url` text,
	`cert_enabled` integer DEFAULT false NOT NULL,
	`body_enabled` integer DEFAULT false NOT NULL,
	`coach_can_work` integer DEFAULT true NOT NULL,
	`chat_progress_share` integer DEFAULT true NOT NULL,
	`last_chat_push_at` text,
	`eo_pass_url` text,
	`eo_customer_id` text,
	`eo_pass_serial` text,
	`eo_pass_type_id` text,
	`eo_pass_installed_at` text,
	`eo_pass_last_push_at` text,
	`cl_drip_webhook_url` text,
	`cl_user_ns` text,
	`cl_api_token` text,
	`cl_bot_fields` text DEFAULT '{}' NOT NULL,
	`cl_bot_fields_pushed_at` text,
	`cl_bot_source_key` text,
	`price_answer` text,
	`what_i_do` text,
	`price_mode` text DEFAULT 'full' NOT NULL,
	`range_line` text,
	`payment_plan_line` text,
	`guarantee_line` text,
	`guarantee_coverage_line` text,
	`guarantee_terms` text DEFAULT '{}' NOT NULL,
	`guarantee_terms_url` text,
	`default_path` text DEFAULT 'call' NOT NULL,
	`bot_prices_on` integer DEFAULT true NOT NULL,
	`call_minutes` integer,
	`one_on_one_range` text,
	`guarantee_lead_in` text,
	`people_word` text,
	`bot_examples` text DEFAULT '[]' NOT NULL,
	`bot_stories` text DEFAULT '[]' NOT NULL,
	`bot_question_1` text,
	`bot_question_2` text,
	`bot_question_3` text,
	`cl_bot_fields_pushed_by` text,
	`cl_agent_ns` text,
	`faq_bot_field` text,
	`faq_overwrite_ok` integer DEFAULT false NOT NULL,
	`removed_at` text,
	`removed_by` text,
	`ai_cap_exempt` integer DEFAULT false NOT NULL,
	`celebrated_tier_level` integer,
	`whats_new_seen` integer,
	`timezone` text,
	`last_nudged_at` text,
	`fathom_consent_at` text,
	`last_comeback_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_memberships`("id", "workspace_id", "user_id", "role", "program_tier", "business_name", "big_promise", "audience", "emails_enabled", "reminder_hour", "evening_reminder_hour", "leaderboard_opt_in", "started_at", "pass_enabled", "pass_name", "pass_url", "pass_webhook_url", "pass_hashtag", "pass_community_url", "cert_enabled", "body_enabled", "coach_can_work", "chat_progress_share", "last_chat_push_at", "eo_pass_url", "eo_customer_id", "eo_pass_serial", "eo_pass_type_id", "eo_pass_installed_at", "eo_pass_last_push_at", "cl_drip_webhook_url", "cl_user_ns", "cl_api_token", "cl_bot_fields", "cl_bot_fields_pushed_at", "cl_bot_source_key", "price_answer", "what_i_do", "price_mode", "range_line", "payment_plan_line", "guarantee_line", "guarantee_coverage_line", "guarantee_terms", "guarantee_terms_url", "default_path", "bot_prices_on", "call_minutes", "one_on_one_range", "guarantee_lead_in", "people_word", "bot_examples", "bot_stories", "bot_question_1", "bot_question_2", "bot_question_3", "cl_bot_fields_pushed_by", "cl_agent_ns", "faq_bot_field", "faq_overwrite_ok", "removed_at", "removed_by", "ai_cap_exempt", "celebrated_tier_level", "whats_new_seen", "timezone", "last_nudged_at", "fathom_consent_at", "last_comeback_at", "created_at") SELECT "id", "workspace_id", "user_id", "role", "program_tier", "business_name", "big_promise", "audience", "emails_enabled", "reminder_hour", "evening_reminder_hour", "leaderboard_opt_in", "started_at", "pass_enabled", "pass_name", "pass_url", "pass_webhook_url", "pass_hashtag", "pass_community_url", "cert_enabled", "body_enabled", "coach_can_work", "chat_progress_share", "last_chat_push_at", "eo_pass_url", "eo_customer_id", "eo_pass_serial", "eo_pass_type_id", "eo_pass_installed_at", "eo_pass_last_push_at", "cl_drip_webhook_url", "cl_user_ns", "cl_api_token", "cl_bot_fields", "cl_bot_fields_pushed_at", "cl_bot_source_key", "price_answer", "what_i_do", "price_mode", "range_line", "payment_plan_line", "guarantee_line", "guarantee_coverage_line", "guarantee_terms", "guarantee_terms_url", "default_path", "bot_prices_on", "call_minutes", "one_on_one_range", "guarantee_lead_in", "people_word", "bot_examples", "bot_stories", "bot_question_1", "bot_question_2", "bot_question_3", "cl_bot_fields_pushed_by", "cl_agent_ns", "faq_bot_field", "faq_overwrite_ok", "removed_at", "removed_by", "ai_cap_exempt", "celebrated_tier_level", "whats_new_seen", "timezone", "last_nudged_at", "fathom_consent_at", "last_comeback_at", "created_at" FROM `memberships`;--> statement-breakpoint
DROP TABLE `memberships`;--> statement-breakpoint
ALTER TABLE `__new_memberships` RENAME TO `memberships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_ws_user` ON `memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `community_posts` ADD `image_id` text;--> statement-breakpoint
ALTER TABLE `community_posts` ADD `image_key` text;--> statement-breakpoint
ALTER TABLE `community_posts` ADD `image_url` text;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `month_image_id` text;--> statement-breakpoint
ALTER TABLE `community_settings` ADD `monday_image_id` text;--> statement-breakpoint
-- Danno, 1 Oct (rev 285's answers): coach working access is on by default for every new client, every tier; the client turns it
-- off in Settings. The 0087 backfill flipped the coach-created clients who had never signed in; this extends it to every
-- coach-created client (emails off is the import's mark) still off, signed in or not. A self-joined client is left as they are.
-- Each flip is logged as the switch's own event, as 0087 did.
INSERT INTO `sync_events` (`id`, `workspace_id`, `user_id`, `provider`, `direction`, `event`, `payload`, `status`, `note`)
SELECT lower(hex(randomblob(16))), m.`workspace_id`, m.`user_id`, 'account', 'in', 'coach_work.on', '{"backfill":"1 Oct, on by default"}', 'sent', 'Let my coach work in my HelixOS: on (backfill: on by default for every coach-created client)'
FROM `memberships` m
WHERE m.`role` = 'client' AND m.`coach_can_work` = 0 AND m.`emails_enabled` = 0 AND m.`removed_at` IS NULL;
--> statement-breakpoint
UPDATE `memberships` SET `coach_can_work` = 1
WHERE `role` = 'client' AND `coach_can_work` = 0 AND `emails_enabled` = 0 AND `removed_at` IS NULL;
