import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0202 (H-622): the coach's own program's "Issue passes" switch, off by default. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0202: the Issue passes switch", () => {
  it("adds one column to leaderboard_feeds, off by default, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0137_leaderboard_feeds.sql")) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f', 'w', 'u', 'm', 'evolve-omega-abc123')");
    const SQL = read("0202_eo_pass.sql");
    expect(SQL).toEqual(["ALTER TABLE `leaderboard_feeds` ADD `issue_passes` integer DEFAULT false NOT NULL;"]);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT issue_passes FROM leaderboard_feeds")).rows[0]).toMatchObject({ issue_passes: 0 });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0202_eo_pass");
    expect(journal.entries[at - 1]?.tag).toBe("0200_webinar_drafts");
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
