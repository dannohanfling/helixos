CREATE TABLE `fathom_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`last4` text DEFAULT '' NOT NULL,
	`last_validated_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fathom_connections_ws_user` ON `fathom_connections` (`workspace_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `fathom_consent_at` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `quote` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `source_recording_id` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `source_timestamp` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `source_recorded_at` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `context_before` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `context_after` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `permission_at` text;--> statement-breakpoint
ALTER TABLE `proofs` ADD `permission_by` text;--> statement-breakpoint
ALTER TABLE `webinar_beliefs` ADD `proof_id` text;