ALTER TABLE `memberships` ADD `tz_prompt_seen_at` text;--> statement-breakpoint
-- H-457: members who already have a zone of their own keep it without the one-time line; it is for those who never had one.
UPDATE `memberships` SET `tz_prompt_seen_at` = datetime('now') WHERE `timezone` IS NOT NULL;
