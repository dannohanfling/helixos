import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0191 (H-493): the points outbox's table, and the Points desk's allowlist, pause and check on the feed row. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0191: the points outbox and the Points desk", () => {
  it("creates loyalty_points_moves with its unique source, adds five columns to leaderboard_feeds, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0137_leaderboard_feeds.sql")) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f', 'w', 'u', 'm', 'christian-abc123')");
    const SQL = read("0191_kk_desk.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE)|__new_/i.test(s))).toEqual([]);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT desk_user_ids, moves_paused, desk_check_at, desk_check_ok, desk_check_note FROM leaderboard_feeds")).rows[0]).toMatchObject({ desk_user_ids: "[]", moves_paused: 0, desk_check_at: null, desk_check_ok: null, desk_check_note: null });
    const move = "INSERT INTO loyalty_points_moves (id, feed_id, workspace_id, customer_id, delta, reason, source, by_user_id) VALUES (?, 'f', 'w', 'cus_1', -25, 'Redeemed [HX-1]', 'desk:1', 'u')";
    await c.execute({ sql: move, args: ["m1"] });
    await expect(c.execute({ sql: move, args: ["m2"] })).rejects.toThrow(/UNIQUE/);
    expect((await c.execute("SELECT status, check_first, attempts FROM loyalty_points_moves")).rows[0]).toMatchObject({ status: "pending", check_first: 0, attempts: 0 });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0191_kk_desk");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0189_first_arrival");
  });
});
