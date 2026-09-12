CREATE TABLE `proof_attachment_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proof_attachment_reads_ws` ON `proof_attachment_reads` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `proof_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`proof_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`blob_key` text NOT NULL,
	`blob_url` text NOT NULL,
	`display_key` text,
	`display_url` text,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`original_filename` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_seconds` real,
	`alt_text` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`shows_a_person` integer DEFAULT false NOT NULL,
	`shows_a_result` integer DEFAULT false NOT NULL,
	`own_screen_at` text,
	`consent_recorded_at` text,
	`consent_name` text,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`proof_id`) REFERENCES `proofs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proof_attachments_proof` ON `proof_attachments` (`proof_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `proof_attachments_ws` ON `proof_attachments` (`workspace_id`);