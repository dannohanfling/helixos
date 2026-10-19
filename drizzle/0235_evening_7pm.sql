-- The evening reminder at 7 PM (H-922 item 1, plan H-1130, Danno's Approve H-1144, option A): members still on the old 5 PM
-- default move to 7 PM, in their own time zone; anyone who chose a different hour keeps it. Push and the evening email both read this column.
-- The database default stays 17 on purpose: the app writes 19 itself on every insert (schema.ts `.default(19)`, which drizzle
-- puts in the INSERT), and changing a SQLite column default means rebuilding `memberships`, which isn't worth it (H-1138).
UPDATE `memberships` SET `evening_reminder_hour` = 19 WHERE `evening_reminder_hour` = 17;
