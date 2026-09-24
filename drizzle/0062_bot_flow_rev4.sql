-- The bot flow, rev 4. price_mode and range_line stay, unread: the money flow replaces them, and a coach's early price answer is
-- the existing price_answer (what price mode "never" said). Every approval stays keyed by its exact text, so the new facts start unapproved.
ALTER TABLE `memberships` ADD `default_path` text DEFAULT 'call' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `call_minutes` integer;--> statement-breakpoint
ALTER TABLE `memberships` ADD `one_on_one_range` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `guarantee_lead_in` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `people_word` text;--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_examples` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `bot_stories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_terms_when` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `bot_cancel_line` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `on_bot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `proofs` ADD `bot_fits` text;