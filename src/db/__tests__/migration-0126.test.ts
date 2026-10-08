import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0126 (Business goals BG1): the plan's records and links, one link per pair, nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0126_business_goals.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0126: business goals", () => {
  it("makes plan_records and plan_links, with one link per pair and the record defaults", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of SQL) await c.execute(s);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(["plan_links", "plan_records"]);
    await c.execute("INSERT INTO plan_records (id, workspace_id, user_id, kind, title) VALUES ('g1', 'w', 'u', 'goal', 'Three clients')");
    const r = (await c.execute("SELECT status, \"primary\", \"order\", archived_at FROM plan_records")).rows[0];
    expect([r.status, r.primary, r.order, r.archived_at]).toEqual(["not_started", 0, 0, null]);
    await c.execute("INSERT INTO plan_links (id, workspace_id, user_id, from_id, to_id) VALUES ('l1', 'w', 'u', 'g1', 'k1')");
    await expect(c.execute("INSERT INTO plan_links (id, workspace_id, user_id, from_id, to_id) VALUES ('l2', 'w', 'u', 'g1', 'k1')")).rejects.toThrow();
    expect((await c.execute("SELECT to_kind FROM plan_links")).rows[0].to_kind).toBe("record");
  });
});
