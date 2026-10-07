DROP INDEX `brand_kits_workspace_id_unique`;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_display_name` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_handle` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_avatar_image_id` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_gold_from` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_gold_to` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `graphic_font` text;--> statement-breakpoint
UPDATE `brand_kits` SET `user_id` = COALESCE((SELECT `di`.`user_id` FROM `deck_images` `di` WHERE `di`.`id` = `brand_kits`.`logo_image_id`), (SELECT `m`.`user_id` FROM `memberships` `m` WHERE `m`.`workspace_id` = `brand_kits`.`workspace_id` AND `m`.`role` = 'coach' AND `m`.`removed_at` IS NULL ORDER BY `m`.`started_at`, `m`.`id` LIMIT 1), '') WHERE `user_id` = '';--> statement-breakpoint
INSERT INTO `brand_kits` (`id`, `workspace_id`, `user_id`, `name`, `ground`, `ink`, `accent`, `muted`, `surface`, `inverse_ground`, `inverse_ink`, `display_font`, `body_font`, `quote_font`, `font_fallback`, `logo_image_id`, `logo_dark_image_id`, `banned_colors`, `placeholder`, `aliases`, `show_price_anchor`, `notes`)
SELECT lower(hex(randomblob(16))), `k`.`workspace_id`, `m`.`user_id`, COALESCE(NULLIF(`m`.`business_name`, ''), `w`.`name`), `k`.`ground`, `k`.`ink`, `k`.`accent`, `k`.`muted`, `k`.`surface`, `k`.`inverse_ground`, `k`.`inverse_ink`, `k`.`display_font`, `k`.`body_font`, `k`.`quote_font`, `k`.`font_fallback`, NULL, NULL, `k`.`banned_colors`, `k`.`placeholder`, `k`.`aliases`, `k`.`show_price_anchor`, `k`.`notes`
FROM `brand_kits` `k`
JOIN `memberships` `m` ON `m`.`workspace_id` = `k`.`workspace_id` AND `m`.`role` = 'coach' AND `m`.`removed_at` IS NULL
JOIN `workspaces` `w` ON `w`.`id` = `k`.`workspace_id`
WHERE `k`.`user_id` <> '' AND `k`.`user_id` <> `m`.`user_id` AND NOT EXISTS (SELECT 1 FROM `brand_kits` `k2` WHERE `k2`.`workspace_id` = `k`.`workspace_id` AND `k2`.`user_id` = `m`.`user_id`);--> statement-breakpoint
DELETE FROM `brand_kits` WHERE `user_id` = '';--> statement-breakpoint
CREATE UNIQUE INDEX `brand_kits_member` ON `brand_kits` (`workspace_id`,`user_id`);
