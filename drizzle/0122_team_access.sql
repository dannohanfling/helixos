CREATE TABLE `team_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team_member_id` text NOT NULL,
	`team_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`action` text,
	`page` text,
	`item` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_changes_owner` ON `team_changes` (`owner_membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_by` text NOT NULL,
	`code_hash` text NOT NULL,
	`label` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_user_id` text,
	`revoked_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_code_hash_unique` ON `team_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `team_invites_owner` ON `team_invites` (`owner_membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_membership_id` text NOT NULL,
	`user_id` text NOT NULL,
	`team_user_id` text NOT NULL,
	`added_by` text NOT NULL,
	`last_active_at` text,
	`removed_at` text,
	`removed_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `team_members_owner` ON `team_members` (`owner_membership_id`,`removed_at`);--> statement-breakpoint
CREATE INDEX `team_members_user` ON `team_members` (`team_user_id`,`removed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_live` ON `team_members` (`owner_membership_id`,`team_user_id`) WHERE removed_at IS NULL;--> statement-breakpoint
ALTER TABLE `memberships` ADD `team_cap` integer DEFAULT 5 NOT NULL;