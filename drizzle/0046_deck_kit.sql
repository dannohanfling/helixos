ALTER TABLE `brand_kits` ADD `placeholder` text;--> statement-breakpoint
ALTER TABLE `brand_kits` ADD `aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `webinars` SET `registered` = NULL, `showed` = NULL, `offers_made` = NULL, `calls_booked` = NULL, `sales` = NULL, `revenue` = NULL WHERE `status` != 'delivered' AND coalesce(`registered`, 0) = 0 AND coalesce(`showed`, 0) = 0 AND coalesce(`offers_made`, 0) = 0 AND coalesce(`calls_booked`, 0) = 0 AND coalesce(`sales`, 0) = 0 AND coalesce(`revenue`, 0) = 0;
