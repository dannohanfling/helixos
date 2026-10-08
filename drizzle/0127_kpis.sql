CREATE TABLE `kpi_values` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kpi_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kpi_values_day` ON `kpi_values` (`kpi_id`,`date`);--> statement-breakpoint
CREATE INDEX `kpi_values_user` ON `kpi_values` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `kpis` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`record_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'count' NOT NULL,
	`target` real DEFAULT 0 NOT NULL,
	`period` text DEFAULT 'month' NOT NULL,
	`period_start` text,
	`period_end` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`metric` text,
	`archived_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kpis_record` ON `kpis` (`workspace_id`,`user_id`,`record_id`);