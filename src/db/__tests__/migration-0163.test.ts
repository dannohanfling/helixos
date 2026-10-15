import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0163 (H-109): a leaderboard's earlier addresses, one table, each address once across all boards. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0163: leaderboard slug aliases", () => {
  it("adds one table with a unique slug and an index by feed, and touches nothing else", async () => {
    const c = createClient({ url: ":memory:" });
    const SQL = read("0163_leaderboard_slug_aliases.sql");
    expect(SQL).toHaveLength(3);
    expect(SQL[0]).toMatch(/^CREATE TABLE `leaderboard_slug_aliases`/);
    expect(SQL.join("\n")).not.toMatch(/ALTER TABLE|__new_/);
    for (const s of SQL) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_slug_aliases (id, feed_id, slug) VALUES ('a', 'f1', 'old-address-1')");
    await c.execute("INSERT INTO leaderboard_slug_aliases (id, feed_id, slug) VALUES ('b', 'f1', 'old-address-2')");
    await expect(c.execute("INSERT INTO leaderboard_slug_aliases (id, feed_id, slug) VALUES ('c', 'f2', 'old-address-1')")).rejects.toThrow(/UNIQUE/);
    expect((await c.execute("SELECT count(*) AS n FROM leaderboard_slug_aliases WHERE feed_id = 'f1'")).rows[0]).toMatchObject({ n: 2 });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0163_leaderboard_slug_aliases");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0162_my_helix");
  });
});
