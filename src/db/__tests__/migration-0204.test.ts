import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0204 (H-622 §2): the loyalty health view's certificate and 429 columns on leaderboard_feeds. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0204: the loyalty health columns", () => {
  it("adds four columns to leaderboard_feeds with their defaults, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0137_leaderboard_feeds.sql")) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f1', 'ws', 'u', 'm', 'slug-1')");
    const SQL = read("0204_loyalty_health.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE)|__new_/i.test(s))).toEqual([]);
    expect(SQL.every((s) => s.startsWith("ALTER TABLE `leaderboard_feeds` ADD"))).toBe(true);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT pass_type_id, cert_expires_at, rate_limited_count, rate_limited_at FROM leaderboard_feeds")).rows[0]).toMatchObject({ pass_type_id: null, cert_expires_at: null, rate_limited_count: 0, rate_limited_at: null });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0204_loyalty_health");
    expect(journal.entries[at - 1]?.tag).toBe("0202_eo_pass");
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
