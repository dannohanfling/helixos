CREATE TABLE `body_ingest_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`label` text DEFAULT 'Apple Health' NOT NULL,
	`token_hash` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_ingest_tokens_hash` ON `body_ingest_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `body_ingest_tokens_member` ON `body_ingest_tokens` (`workspace_id`,`user_id`);