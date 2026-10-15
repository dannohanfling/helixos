import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0165 (H-102): the points check's one sealed snapshot and its time, on the feed row. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0165: points check", () => {
  it("adds two nullable columns to leaderboard_feeds and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0137_leaderboard_feeds.sql")) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f', 'w', 'u', 'm', 'christian-abc123')");
    const SQL = read("0165_points_check.sql");
    expect(SQL).toHaveLength(2);
    for (const s of SQL) {
      expect(s).toMatch(/^ALTER TABLE `leaderboard_feeds` ADD `(points_check_sealed|points_check_at)` text;?$/);
      await c.execute(s);
    }
    expect((await c.execute("SELECT points_check_sealed, points_check_at FROM leaderboard_feeds")).rows[0]).toMatchObject({ points_check_sealed: null, points_check_at: null });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0165_points_check");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0164_aqueduct");
  });
});
