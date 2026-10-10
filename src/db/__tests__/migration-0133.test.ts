import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0133 (rev 618): Bot Features' rules and requests, and the coach's unlock toggles on a client's membership. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0133_bot_features.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0133: Bot Features", () => {
  it("adds two tables and an empty toggle list on each membership, and touches nothing else", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE memberships (id text PRIMARY KEY, role text)");
    await c.execute("INSERT INTO memberships (id, role) VALUES ('m', 'client')");
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT role, bot_unlocks FROM memberships")).rows[0]).toMatchObject({ role: "client", bot_unlocks: "[]" });
    await c.execute("INSERT INTO bot_feature_requests (id, workspace_id, user_id, feature_key) VALUES ('r', 'w', 'u', 'freebie_delivery')");
    expect((await c.execute("SELECT state, setup FROM bot_feature_requests")).rows[0]).toMatchObject({ state: "requested", setup: "{}" });
    await expect(c.execute("INSERT INTO bot_feature_requests (id, workspace_id, user_id, feature_key) VALUES ('r2', 'w', 'u', 'freebie_delivery')")).rejects.toThrow(/UNIQUE/);
    await c.execute("INSERT INTO bot_feature_rules (id, workspace_id, feature_key, type) VALUES ('x', 'w', 'win_back_nudge', 'free')");
    expect((await c.execute("SELECT value FROM bot_feature_rules")).rows[0].value).toBe("");
  });
});
