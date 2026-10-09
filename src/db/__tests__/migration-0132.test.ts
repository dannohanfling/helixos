import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0132 (rev 618): the teaching library, the story bank, what each ladder was given, and the two search indexes. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0132_teaching_library.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0132: the teaching library and story bank", () => {
  it("adds three tables and two full-text indexes, and touches nothing else", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE ladders (id text PRIMARY KEY)");
    await c.execute("INSERT INTO ladders (id) VALUES ('l')");
    for (const s of SQL) await c.execute(s);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('teaching_entries','story_items','ladder_material','teaching_fts','story_fts') ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(["ladder_material", "story_fts", "story_items", "teaching_entries", "teaching_fts"]);
    expect((await c.execute("SELECT count(*) AS n FROM ladders")).rows[0].n).toBe(1);
    await c.execute("INSERT INTO story_items (id, workspace_id, user_id, key, title, type, what, digest) VALUES ('s', 'w', 'u', 'k', 't', 'story', 'w', 'd')");
    expect((await c.execute("SELECT status, has_price FROM story_items")).rows[0]).toMatchObject({ status: "check", has_price: 0 });
    await c.execute("INSERT INTO teaching_fts (question, answer, topic, category, entry_id, user_id) VALUES ('How do I price a webinar?', 'Start with the outcome.', 'Webinars', 'Offers', 'e1', 'u')");
    const hit = await c.execute({ sql: "SELECT entry_id FROM teaching_fts WHERE teaching_fts MATCH ? AND user_id = ? ORDER BY bm25(teaching_fts)", args: ['"webinar" OR "outcome"', "u"] });
    expect(hit.rows.map((r) => r.entry_id)).toEqual(["e1"]);
    await c.execute("INSERT INTO ladder_material (id, workspace_id, user_id, ladder_id, kind, item_id, tag) VALUES ('m', 'w', 'u', 'l', 'story', 's', 'S1')");
    await c.execute("PRAGMA foreign_keys = ON");
    await c.execute("DELETE FROM ladders WHERE id = 'l'");
    expect((await c.execute("SELECT count(*) AS n FROM ladder_material")).rows[0].n).toBe(0);
  });
});
