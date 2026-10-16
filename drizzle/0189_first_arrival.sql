ALTER TABLE `memberships` ADD `first_arrival_seen_at` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `first_arrival_seen_at` text;--> statement-breakpoint
-- Everyone here before the first arrival shipped (H-472) has seen it: only accounts made after this get the ceremony.
UPDATE `memberships` SET `first_arrival_seen_at` = datetime('now') WHERE `first_arrival_seen_at` IS NULL;--> statement-breakpoint
UPDATE `team_members` SET `first_arrival_seen_at` = datetime('now') WHERE `first_arrival_seen_at` IS NULL;