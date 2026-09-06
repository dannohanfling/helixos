CREATE TABLE `ladder_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`product_name` text,
	`product_pitch` text,
	`price_line` text,
	`trial_line` text,
	`keywords` text DEFAULT '[]' NOT NULL,
	`scarcity_line` text,
	`banned_phrases` text DEFAULT '[]' NOT NULL,
	`verified_stats` text DEFAULT '[]' NOT NULL,
	`claims_rules` text,
	`origin_story` text,
	`positioning_line` text,
	`handle` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ladder_profiles_ws_user` ON `ladder_profiles` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `ladders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content_item_id` text,
	`format` text NOT NULL,
	`topic` text NOT NULL,
	`audience` text DEFAULT 'warm' NOT NULL,
	`keyword` text DEFAULT 'none' NOT NULL,
	`source_material` text,
	`real_numbers` text,
	`post_name` text DEFAULT '' NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`alt_headlines` text DEFAULT '[]' NOT NULL,
	`hook` text DEFAULT '' NOT NULL,
	`copy` text DEFAULT '' NOT NULL,
	`rungs` text DEFAULT '[]' NOT NULL,
	`dm_keyword` text DEFAULT '' NOT NULL,
	`carousel` text DEFAULT '[]' NOT NULL,
	`ig_caption` text DEFAULT '' NOT NULL,
	`threads_chain` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`generated_by` text DEFAULT 'scaffold' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`launched_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ladders_user` ON `ladders` (`user_id`,`status`);