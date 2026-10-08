ALTER TABLE `proofs` ADD `source_title` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `proofs` ADD `airtable_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `proofs_airtable` ON `proofs` (`user_id`,`airtable_id`);