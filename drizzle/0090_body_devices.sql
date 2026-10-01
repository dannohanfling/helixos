CREATE TABLE `body_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'whoop' NOT NULL,
	`provider_id` text NOT NULL,
	`date` text NOT NULL,
	`sport` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`minutes` real DEFAULT 0 NOT NULL,
	`strain` real,
	`avg_hr` integer,
	`max_hr` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_activities_member_provider_id` ON `body_activities` (`workspace_id`,`user_id`,`provider`,`provider_id`);--> statement-breakpoint
CREATE INDEX `body_activities_member_date` ON `body_activities` (`workspace_id`,`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `body_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'whoop' NOT NULL,
	`provider_user_id` text,
	`access_token` text,
	`refresh_token` text,
	`expires_at` text,
	`scopes` text,
	`connected_at` text,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_devices_member_provider` ON `body_devices` (`workspace_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `body_devices_provider_user` ON `body_devices` (`provider`,`provider_user_id`);