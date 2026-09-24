CREATE TABLE `bot_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`element_key` text NOT NULL,
	`text_hash` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_approvals_member_element_hash` ON `bot_approvals` (`membership_id`,`element_key`,`text_hash`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `what_i_do` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `price_mode` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `range_line` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `payment_plan_line` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `guarantee_line` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `guarantee_coverage_line` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `guarantee_terms` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `guarantee_terms_url` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_question_1` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_question_2` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_question_3` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `cl_bot_fields_pushed_by` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_role` text DEFAULT 'not_on_bot' NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_name` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_for` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_end_result` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_terms` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `deposit_amount` real;--> statement-breakpoint
ALTER TABLE `offers` ADD `refundable_if_not_fit` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_refund_line` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `guarantee_covered` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Every existing offer starts off the bot (bot_role's default); a coach chooses roles before the first push. A member who ticked
-- Never quote prices on any offer keeps that behaviour as price mode "never". The questions are not copied from any offer: every
-- offer is stored under the coach's own account, a client's offer included, so none can be told apart as the coach's own.
UPDATE `memberships` SET `price_mode` = 'never' WHERE EXISTS (SELECT 1 FROM `offers` o WHERE o.`user_id` = `memberships`.`user_id` AND o.`workspace_id` = `memberships`.`workspace_id` AND o.`never_quote_price` = 1);
