import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Hermes, the HelixOS-hosted Magic funnel pages: one row per webinar. "Host pages in HelixOS" (off by default) makes mf_prepare
 * hand out the HelixOS page instead of the GoHighLevel link; the thank-you video and the Meta Pixel ride along. Nothing about a
 * prospect is kept here: their page is their webinar_signups row, read by its code. Until the migration is on a database, the
 * pages read a missing table as "switch off" (src/lib/hermes/settings.ts).
 */
export const hermesPages = sqliteTable(
  "hermes_pages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    webinarId: text("webinar_id").notNull(),
    hostOn: integer("host_on", { mode: "boolean" }).notNull().default(false),
    /** An unlisted YouTube video, played from youtube-nocookie.com on the confirmation page. */
    videoUrl: text("video_url"),
    pixelId: text("pixel_id"),
    pixelOn: integer("pixel_on", { mode: "boolean" }).notNull().default(false),
    /** Registrations that reached HelixOS but not GoHighLevel (the person still saw their confirmation): a count, nothing else. */
    ghlFailed: integer("ghl_failed").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("hermes_pages_webinar").on(t.webinarId), index("hermes_pages_member").on(t.workspaceId, t.userId)],
);
export type HermesPage = typeof hermesPages.$inferSelect;
