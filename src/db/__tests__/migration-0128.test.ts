import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0128 (Make the graphic): the kit's AI backgrounds switch (on), a picture's source (upload), the ladder's graphic; nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0128_make_the_graphic.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0128: make the graphic", () => {
  it("adds four nullable or defaulted columns and creates nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE brand_kits (id text PRIMARY KEY, name text NOT NULL)");
    await c.execute("CREATE TABLE deck_images (id text PRIMARY KEY, kind text NOT NULL)");
    await c.execute("CREATE TABLE ladders (id text PRIMARY KEY, topic text NOT NULL)");
    for (const s of SQL) await c.execute(s);
    expect(SQL.every((s) => /^ALTER TABLE `(brand_kits|deck_images|ladders)` ADD /.test(s))).toBe(true);
    await c.execute("INSERT INTO brand_kits (id, name) VALUES ('k', 'Mine')");
    await c.execute("INSERT INTO deck_images (id, kind) VALUES ('i', 'photo')");
    await c.execute("INSERT INTO ladders (id, topic) VALUES ('l', 'Rebuild')");
    expect((await c.execute("SELECT ai_backgrounds FROM brand_kits")).rows[0].ai_backgrounds).toBe(1);
    expect((await c.execute("SELECT source FROM deck_images")).rows[0].source).toBe("upload");
    const l = (await c.execute("SELECT graphic_image_id, graphic_options FROM ladders")).rows[0];
    expect([l.graphic_image_id, l.graphic_options]).toEqual([null, null]);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(["brand_kits", "deck_images", "ladders"]);
  });
});
