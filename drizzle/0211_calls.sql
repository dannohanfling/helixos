CREATE TABLE `program_call_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`call_id`) REFERENCES `program_calls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `program_call_skips_call_date` ON `program_call_skips` (`call_id`,`date`);--> statement-breakpoint
CREATE TABLE `program_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`weekday` integer NOT NULL,
	`start` text NOT NULL,
	`minutes` integer DEFAULT 60 NOT NULL,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`audience` text DEFAULT 'academy' NOT NULL,
	`link` text,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `program_calls_ws` ON `program_calls` (`workspace_id`,`sort`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `calls_link` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `calls_passcode` text;--> statement-breakpoint
INSERT INTO `program_calls` (`id`, `workspace_id`, `name`, `weekday`, `start`, `minutes`, `timezone`, `audience`, `link`, `active`, `sort`)
SELECT lower(hex(randomblob(16))), w.`id`, d.`name`, d.`weekday`, d.`start`, 60, 'America/Los_Angeles', d.`audience`, NULL, 1, d.`sort`
FROM `workspaces` w, (
  SELECT 'Academy call' AS `name`, 1 AS `weekday`, '10:00' AS `start`, 'academy' AS `audience`, 0 AS `sort`
  UNION ALL SELECT 'Academy call', 2, '10:00', 'academy', 1
  UNION ALL SELECT 'Academy call', 3, '10:00', 'academy', 2
  UNION ALL SELECT 'Academy call', 4, '10:00', 'academy', 3
  UNION ALL SELECT 'Academy call', 5, '13:00', 'academy', 4
  UNION ALL SELECT 'Accelerator Orientation', 1, '09:00', 'accelerator_academy', 5
  UNION ALL SELECT 'Accelerator call', 3, '10:00', 'accelerator_academy', 6
) d
WHERE EXISTS (SELECT 1 FROM `memberships` m WHERE m.`workspace_id` = w.`id` AND m.`role` = 'coach' AND m.`removed_at` IS NULL);--> statement-breakpoint
UPDATE `workspaces` SET `calls_link` = 'https://evolvecalls.com', `calls_passcode` = 'evolve'
WHERE `calls_link` IS NULL AND EXISTS (SELECT 1 FROM `memberships` m WHERE m.`workspace_id` = `workspaces`.`id` AND m.`role` = 'coach' AND m.`removed_at` IS NULL);
