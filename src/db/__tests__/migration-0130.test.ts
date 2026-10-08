import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0130 (Ship): the drip hand-off's target, ids, gap and pin; the ladder's public token and shipped-at; nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0130_ship.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0130: ship", () => {
  it("adds the seven columns with their defaults and creates nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE drip_handoffs (id text PRIMARY KEY, ladder_id text NOT NULL)");
    await c.execute("CREATE TABLE ladders (id text PRIMARY KEY, topic text NOT NULL)");
    for (const s of SQL) await c.execute(s);
    expect(SQL.every((s) => /^ALTER TABLE `(drip_handoffs|ladders)` ADD /.test(s))).toBe(true);
    await c.execute("INSERT INTO drip_handoffs (id, ladder_id) VALUES ('h', 'l')");
    await c.execute("INSERT INTO ladders (id, topic) VALUES ('l', 'Rebuild')");
    const h = (await c.execute("SELECT target, fb_post_id, ig_media_id, gap_minutes, pin_last FROM drip_handoffs")).rows[0];
    expect([h.target, h.fb_post_id, h.ig_media_id, h.gap_minutes, h.pin_last]).toEqual(["both", null, null, null, 0]);
    const l = (await c.execute("SELECT graphic_public_token, shipped_at FROM ladders")).rows[0];
    expect([l.graphic_public_token, l.shipped_at]).toEqual([null, null]);
    expect((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((x) => x.name)).toEqual(["drip_handoffs", "ladders"]);
  });
});
