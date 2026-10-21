CREATE TABLE `agent_client_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`client_membership_id` text NOT NULL,
	`granted_at` text DEFAULT (datetime('now')) NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_client_grants_client` ON `agent_client_grants` (`client_membership_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_client_grants_agent` ON `agent_client_grants` (`agent_id`);--> statement-breakpoint
ALTER TABLE `coach_changes` ADD `agent_id` text;--> statement-breakpoint
ALTER TABLE `connected_apps` ADD `switched_membership_id` text;