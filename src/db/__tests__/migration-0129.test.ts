import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0129 (the keyword router): two columns on memberships, what the bot holds and when it was pushed; nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0129_keyword_router.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0129: the keyword router's record", () => {
  it("adds the held fields (empty) and the pushed-at (null) to memberships and creates nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE memberships (id text PRIMARY KEY, user_id text NOT NULL)");
    for (const s of SQL) await c.execute(s);
    expect(SQL.every((s) => /^ALTER TABLE `memberships` ADD /.test(s))).toBe(true);
    await c.execute("INSERT INTO memberships (id, user_id) VALUES ('m', 'u')");
    const r = (await c.execute("SELECT cl_keywords_held, cl_keywords_pushed_at FROM memberships")).rows[0];
    expect([r.cl_keywords_held, r.cl_keywords_pushed_at]).toEqual(["{}", null]);
    expect((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((x) => x.name)).toEqual(["memberships"]);
  });
});
