import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0137 (rev 639): a client's loyalty-pass leaderboard feed, one per membership, one address each. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0137_leaderboard_feeds.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0137: leaderboard feeds", () => {
  it("adds one table, defaults to eLoyalty with nothing hidden, and keeps addresses and memberships unique", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of SQL) await c.execute(s);
    await c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('f', 'w', 'u', 'm', 'christian-abc123')");
    expect((await c.execute("SELECT host, hidden, key_encrypted FROM leaderboard_feeds")).rows[0]).toMatchObject({ host: "https://www.eloyalty.ai", hidden: "[]", key_encrypted: null });
    await expect(c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('g', 'w', 'u2', 'm2', 'christian-abc123')")).rejects.toThrow(/UNIQUE/);
    await expect(c.execute("INSERT INTO leaderboard_feeds (id, workspace_id, user_id, membership_id, slug) VALUES ('h', 'w', 'u', 'm', 'other-1')")).rejects.toThrow(/UNIQUE/);
    expect(SQL.length).toBe(3);
  });
});
