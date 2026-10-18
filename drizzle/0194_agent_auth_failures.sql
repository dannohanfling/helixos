CREATE TABLE `agent_auth_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`workspace_id` text,
	`user_id` text,
	`agent_id` text,
	`minute` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_auth_failures_scope_minute` ON `agent_auth_failures` (`scope`,`minute`);--> statement-breakpoint
CREATE INDEX `agent_auth_failures_agent` ON `agent_auth_failures` (`agent_id`);