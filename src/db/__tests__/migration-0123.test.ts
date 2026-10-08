import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0123 (deck layouts 10): the coach's choices per slide, one row per slide key per webinar, gone with the webinar. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0123_deck_slide_choices.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0123: deck slide choices", () => {
  it("makes the table with one row per slide key, cascading with the webinar", async () => {
    const c = createClient({ url: ":memory:" });
    await c.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE webinars (id text PRIMARY KEY NOT NULL);
      INSERT INTO webinars (id) VALUES ('w1');
    `);
    for (const s of SQL) await c.execute(s);
    await c.execute("INSERT INTO deck_slide_choices (id, webinar_id, slide_key, layout, accent_phrase) VALUES ('c1', 'w1', 'hook:1', 'statement', '602 comments')");
    await expect(c.execute("INSERT INTO deck_slide_choices (id, webinar_id, slide_key) VALUES ('c2', 'w1', 'hook:1')")).rejects.toThrow();
    expect((await c.execute("SELECT accent_off FROM deck_slide_choices")).rows[0].accent_off).toBe(0);
    await c.execute("DELETE FROM webinars WHERE id = 'w1'");
    expect((await c.execute("SELECT count(*) AS n FROM deck_slide_choices")).rows[0].n).toBe(0);
  });
});
