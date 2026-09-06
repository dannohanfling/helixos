ALTER TABLE `integrations` ADD `inbound_secret_hash` text;--> statement-breakpoint
CREATE INDEX `integrations_inbound_hash` ON `integrations` (`inbound_secret_hash`);