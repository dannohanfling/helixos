import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0134 (rev 625): Ship's rungs-only webhook on the membership, and when a member edited their Office Hours request. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0134_rungs_hook_ooh_edited.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0134: the rungs webhook and Office Hours' edited time", () => {
  it("adds two empty columns and touches nothing else", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE memberships (id text PRIMARY KEY, cl_drip_webhook_url text)");
    await c.execute("CREATE TABLE office_hours_requests (id text PRIMARY KEY, created_at text)");
    await c.execute("INSERT INTO memberships (id, cl_drip_webhook_url) VALUES ('m', 'sealed')");
    await c.execute("INSERT INTO office_hours_requests (id, created_at) VALUES ('o', '2026-10-09 17:42:00')");
    for (const s of SQL) await c.execute(s);
    const m = (await c.execute("SELECT cl_drip_webhook_url, cl_rungs_webhook_url FROM memberships")).rows[0];
    expect([m.cl_drip_webhook_url, m.cl_rungs_webhook_url]).toEqual(["sealed", null]);
    const o = (await c.execute("SELECT created_at, edited_at FROM office_hours_requests")).rows[0];
    expect([o.created_at, o.edited_at]).toEqual(["2026-10-09 17:42:00", null]);
    expect(SQL.length).toBe(2);
  });
});
