-- Rev 275: a client the coach created (imported) may have their coach work in their HelixOS (rev 216 set that default in the
-- import), but clients created before that default landed got it off. The import is the one path that creates a client with
-- emails off, and a client who has never signed in can only be one the coach created, so those two together name them.
-- Each flip is logged as the import's own action, the way the client's own switch is.
INSERT INTO `sync_events` (`id`, `workspace_id`, `user_id`, `provider`, `direction`, `event`, `payload`, `status`, `note`)
SELECT lower(hex(randomblob(16))), m.`workspace_id`, m.`user_id`, 'account', 'in', 'coach_work.on', '{"backfill":"rev 275"}', 'sent', 'Let my coach work in my HelixOS: on (backfill: a client the coach created, before the import set it)'
FROM `memberships` m JOIN `users` u ON u.`id` = m.`user_id`
WHERE m.`role` = 'client' AND m.`coach_can_work` = 0 AND m.`emails_enabled` = 0 AND m.`removed_at` IS NULL AND u.`first_signed_in_at` IS NULL;
--> statement-breakpoint
UPDATE `memberships` SET `coach_can_work` = 1
WHERE `role` = 'client' AND `coach_can_work` = 0 AND `emails_enabled` = 0 AND `removed_at` IS NULL
  AND `user_id` IN (SELECT `id` FROM `users` WHERE `first_signed_in_at` IS NULL);
