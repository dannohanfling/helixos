ALTER TABLE `recordings` ADD `clear_title` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `recording_rules` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `recording_rules_from` text;--> statement-breakpoint
UPDATE `workspaces` SET `recording_rules_from` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
UPDATE `recordings` SET `note` = NULL, `title_match` = 'none' WHERE `status` = 'draft' AND (`title_match` = 'close' OR `note` LIKE 'recorded before Recordings%');
