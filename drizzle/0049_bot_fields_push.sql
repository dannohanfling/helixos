ALTER TABLE `memberships` ADD `cl_api_token` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_bot_fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_bot_fields_pushed_at` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `qualifying_question_1` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `qualifying_question_2` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `qualifying_question_3` text;