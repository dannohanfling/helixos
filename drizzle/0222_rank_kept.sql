ALTER TABLE `memberships` ADD `rank_kept_level` integer;--> statement-breakpoint
-- H-1088: everyone keeps the rank they hold today. Backfilled once, from each membership's ledger total under the thresholds
-- in force until this migration (100, 500, 1,500, 3,000, 7,500, 15,000, 30,000, 60,000), or the rank already celebrated if
-- that is higher. No points move and no ledger rows are written.
UPDATE `memberships` SET `rank_kept_level` = max(
  coalesce(`celebrated_tier_level`, 1),
  (SELECT CASE
     WHEN t >= 60000 THEN 9 WHEN t >= 30000 THEN 8 WHEN t >= 15000 THEN 7 WHEN t >= 7500 THEN 6
     WHEN t >= 3000 THEN 5 WHEN t >= 1500 THEN 4 WHEN t >= 500 THEN 3 WHEN t >= 100 THEN 2 ELSE 1 END
   FROM (SELECT coalesce(sum(p.`points`), 0) AS t FROM `points_ledger` p
         WHERE p.`workspace_id` = `memberships`.`workspace_id` AND p.`user_id` = `memberships`.`user_id`))
);
