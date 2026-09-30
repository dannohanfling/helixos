ALTER TABLE `tasks` ADD `review_state` text;--> statement-breakpoint
-- The clients already imported: every open task from Airtable waits for review, and one marked Today there is an ordinary open task here.
UPDATE `tasks` SET `review_state` = 'to_review' WHERE `source` = 'airtable' AND `status` != 'done';--> statement-breakpoint
UPDATE `tasks` SET `status` = 'upcoming' WHERE `source` = 'airtable' AND `status` = 'today' AND `focus_date` IS NULL;
