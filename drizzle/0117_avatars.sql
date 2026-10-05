CREATE TABLE `avatar_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`avatar_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`main` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`avatar_id`) REFERENCES `avatars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avatar_offers_pair` ON `avatar_offers` (`avatar_id`,`offer_id`);--> statement-breakpoint
CREATE INDEX `avatar_offers_member` ON `avatar_offers` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `avatar_offers_offer` ON `avatar_offers` (`offer_id`);--> statement-breakpoint
CREATE TABLE `avatars` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`one_line` text,
	`who` text,
	`pains` text,
	`wants` text,
	`tried` text,
	`objections` text,
	`hangouts` text,
	`phrases` text,
	`trigger` text,
	`framework` text,
	`not_for` text,
	`primary` integer DEFAULT false NOT NULL,
	`imported` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `avatars_member` ON `avatars` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `avatars_parent` ON `avatars` (`parent_id`);