ALTER TABLE `library_assets` ADD `reframes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_assets` ADD `underneath` text;--> statement-breakpoint
ALTER TABLE `library_assets` ADD `belief` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `objection_asset_ids` text DEFAULT '[]' NOT NULL;