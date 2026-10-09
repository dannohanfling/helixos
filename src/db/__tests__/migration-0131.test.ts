import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0131 (client headshots): six photo columns on memberships, the badge's consent on the kit, the review table. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0131_client_headshots.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0131: client headshots", () => {
  it("adds the photo columns (empty), the consent (off) and the review table, one row per attachment", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE memberships (id text PRIMARY KEY, user_id text NOT NULL)");
    await c.execute("CREATE TABLE brand_kits (id text PRIMARY KEY, name text NOT NULL)");
    for (const s of SQL) await c.execute(s);
    await c.execute("INSERT INTO memberships (id, user_id) VALUES ('m', 'u')");
    await c.execute("INSERT INTO brand_kits (id, name) VALUES ('k', 'Mine')");
    const m = (await c.execute("SELECT headshot_url, headshot_display_url, headshot_source, headshot_airtable_id FROM memberships")).rows[0];
    expect([m.headshot_url, m.headshot_display_url, m.headshot_source, m.headshot_airtable_id]).toEqual([null, null, null, null]);
    expect((await c.execute("SELECT graphic_use_headshot FROM brand_kits")).rows[0].graphic_use_headshot).toBe(0);
    await c.execute("INSERT INTO headshot_reviews (id, workspace_id, airtable_record_id, attachment_id, reason) VALUES ('r1', 'w', 'rec1', 'att1', 'no_email')");
    const r = (await c.execute("SELECT status, candidates, name FROM headshot_reviews")).rows[0];
    expect([r.status, r.candidates, r.name]).toEqual(["open", "[]", ""]);
    await expect(c.execute("INSERT INTO headshot_reviews (id, workspace_id, airtable_record_id, attachment_id, reason) VALUES ('r2', 'w', 'rec2', 'att1', 'no_match')")).rejects.toThrow();
  });
});
