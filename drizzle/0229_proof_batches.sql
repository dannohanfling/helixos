CREATE TABLE `proof_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`proof_ids` text DEFAULT '[]' NOT NULL,
	`corrections` text DEFAULT '[]' NOT NULL,
	`approved_at` text DEFAULT (datetime('now')) NOT NULL,
	`undone_at` text
);
--> statement-breakpoint
CREATE INDEX `proof_batches_user` ON `proof_batches` (`user_id`,`approved_at`);