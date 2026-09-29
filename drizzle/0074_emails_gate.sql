ALTER TABLE `memberships` ADD `emails_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `first_signed_in_at` text;--> statement-breakpoint
-- Every account made before this was made by joining or setup, and both sign in; none is left as never signed in.
UPDATE `users` SET `first_signed_in_at` = `created_at` WHERE `first_signed_in_at` IS NULL;
