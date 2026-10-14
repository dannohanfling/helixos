ALTER TABLE `memberships` ADD `aqueduct_paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `aqueduct_period` integer DEFAULT 30 NOT NULL;