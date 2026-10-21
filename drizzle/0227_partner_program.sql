CREATE TABLE `partner_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`restaurant_id` text NOT NULL,
	`file_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `partner_restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_files_restaurant` ON `partner_files` (`restaurant_id`,`role`);--> statement-breakpoint
CREATE TABLE `partner_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`restaurant_id` text NOT NULL,
	`date` text NOT NULL,
	`plan` text NOT NULL,
	`amount` real NOT NULL,
	`tax` real DEFAULT 0 NOT NULL,
	`fees_deducted` real DEFAULT 0 NOT NULL,
	`promo` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`processor` text,
	`month` text NOT NULL,
	`external_id` text,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `partner_restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_payments_restaurant_month` ON `partner_payments` (`restaurant_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `partner_payments_external` ON `partner_payments` (`workspace_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `partner_payout_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`restaurant_id` text NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`amount` real NOT NULL,
	`payment_id` text,
	`installment` integer,
	`note` text,
	`approved_by_danno_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `partner_restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_payout_lines_workspace_month` ON `partner_payout_lines` (`workspace_id`,`month`);--> statement-breakpoint
CREATE INDEX `partner_payout_lines_restaurant` ON `partner_payout_lines` (`restaurant_id`,`month`);--> statement-breakpoint
CREATE TABLE `partner_restaurants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`business` text NOT NULL,
	`type` text DEFAULT 'restaurant' NOT NULL,
	`city` text,
	`source` text,
	`referred_by` text,
	`stage` text DEFAULT 'talking' NOT NULL,
	`plan` text,
	`founding_partner` integer DEFAULT false NOT NULL,
	`first_contact_at` text,
	`demo_at` text,
	`signed_at` text,
	`paid_at` text,
	`form_complete_at` text,
	`handed_to_walletpush_at` text,
	`live_at` text,
	`featured_in_group_at` text,
	`cancelled_at` text,
	`setup_approved_at` text,
	`walletpush_status` text DEFAULT 'not handed' NOT NULL,
	`walletpush_note` text,
	`google_reviews_at_start` integer,
	`google_rating_at_start` real,
	`pass_holders` integer,
	`reviews_gained` integer,
	`concierge_chats` integer,
	`results_as_of` text,
	`risk` text DEFAULT 'none' NOT NULL,
	`cancel_reason` text,
	`next_step` text,
	`next_step_date` text,
	`notes` text,
	`address` text,
	`business_phone` text,
	`website` text,
	`facebook_page` text,
	`instagram` text,
	`owner_contact` text,
	`brand_colors` text,
	`hours` text,
	`menu_link` text,
	`google_business_profile` text,
	`reservation_link` text,
	`reward` text,
	`welcome_reward` text,
	`concierge_voice` text,
	`top_customer_questions` text,
	`restaurant_contact_for_messages` text,
	`terms_accepted_at` text,
	`feature_consent` integer DEFAULT false NOT NULL,
	`directory_card` text,
	`extra` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `partner_restaurants_workspace_stage` ON `partner_restaurants` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `partner_restaurants_workspace_business` ON `partner_restaurants` (`workspace_id`,`business`);--> statement-breakpoint
CREATE TABLE `partner_touches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`restaurant_id` text NOT NULL,
	`date` text NOT NULL,
	`who` text NOT NULL,
	`channel` text NOT NULL,
	`first_conversation` integer DEFAULT false NOT NULL,
	`note` text,
	`next_step` text,
	`next_step_date` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`restaurant_id`) REFERENCES `partner_restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `partner_touches_restaurant` ON `partner_touches` (`restaurant_id`,`date`);