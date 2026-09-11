CREATE TABLE `files` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` blob NOT NULL,
	`size` integer NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lead_magnet_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`magnet_id` text NOT NULL,
	`src` text DEFAULT 'other' NOT NULL,
	`day` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`magnet_id`) REFERENCES `lead_magnets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_magnet_hits_magnet` ON `lead_magnet_hits` (`magnet_id`,`day`);--> statement-breakpoint
CREATE TABLE `lead_magnets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`promise` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`offer_id` text,
	`type` text DEFAULT 'checklist' NOT NULL,
	`keyword` text NOT NULL,
	`slug` text NOT NULL,
	`content` text DEFAULT '{"intro":"","sections":[],"closing":""}' NOT NULL,
	`formats` text DEFAULT '{"page":true,"pdf":true,"copy":false,"canva":false}' NOT NULL,
	`primary` text DEFAULT 'page' NOT NULL,
	`pdf_key` text,
	`file_key` text,
	`file_name` text,
	`personal_reply` text,
	`personal_dm` text,
	`chatbot_answer` text,
	`chatbot_delivery` text,
	`chatbot_questions` text DEFAULT '[]' NOT NULL,
	`generated_by` text DEFAULT 'none' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_magnets_slug` ON `lead_magnets` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `lead_magnets_ws_keyword` ON `lead_magnets` (`workspace_id`,`keyword`);--> statement-breakpoint
CREATE INDEX `lead_magnets_user` ON `lead_magnets` (`user_id`);--> statement-breakpoint
ALTER TABLE `ladders` ADD `lead_magnet_id` text;