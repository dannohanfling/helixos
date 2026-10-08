import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0124 (Office Hours time and link, friction walk OH1): two nullable columns on workspaces, nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0124_office_hours_time.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0124: office hours time and link", () => {
  it("adds ooh_time and ooh_link, empty on every existing workspace", async () => {
    const c = createClient({ url: ":memory:" });
    await c.executeMultiple(`
      CREATE TABLE workspaces (id text PRIMARY KEY NOT NULL, name text NOT NULL, timezone text NOT NULL DEFAULT 'America/Los_Angeles');
      INSERT INTO workspaces (id, name) VALUES ('w1', 'Walk');
    `);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT ooh_time, ooh_link, name FROM workspaces")).rows.map((r) => [r.ooh_time, r.ooh_link, r.name])).toEqual([[null, null, "Walk"]]);
    await c.execute("UPDATE workspaces SET ooh_time = 'Fridays at 12:00 pm', ooh_link = 'https://example.com/call' WHERE id = 'w1'");
    expect((await c.execute("SELECT ooh_link FROM workspaces")).rows[0].ooh_link).toBe("https://example.com/call");
  });
});
