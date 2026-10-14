import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0161 (H-29): the hosted leaderboard page's settings, the pasted export, a second template and the cron's backoff, on the feed row. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0161: leaderboard pages", () => {
  it("adds five nullable columns to leaderboard_feeds and rebuilds nothing; an old row reads with them empty", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0137_leaderboard_feeds.sql")) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f', 'w', 'u', 'm', 'christian-abc123')");
    const SQL = read("0161_leaderboard_pages.sql");
    expect(SQL).toHaveLength(5);
    for (const s of SQL) {
      expect(s).toMatch(/^ALTER TABLE `leaderboard_feeds` ADD `(template_id_alt|page_json|export_json|export_as_of|refresh_after)` text;?$/);
      await c.execute(s);
    }
    expect((await c.execute("SELECT template_id_alt, page_json, export_json, export_as_of, refresh_after, host FROM leaderboard_feeds")).rows[0]).toMatchObject({ template_id_alt: null, page_json: null, export_json: null, export_as_of: null, refresh_after: null, host: "https://www.eloyalty.ai" });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    // In the journal, in order after 0158 (later migrations follow it; 0162 My Helix was the first).
    const at = journal.entries.findIndex((e) => e.tag === "0161_leaderboard_pages");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0158_colosseum");
  });
});
