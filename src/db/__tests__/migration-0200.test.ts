import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0200 (H-181): Claude's webinar drafts and their history, two new tables beside webinars, nothing rebuilt. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0200: webinar drafts and history", () => {
  it("creates webinar_drafts and webinar_history with their defaults, and touches no other table", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE webinars (id text PRIMARY KEY NOT NULL)");
    await c.execute("INSERT INTO webinars (id) VALUES ('w1')");
    const SQL = read("0200_webinar_drafts.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE|ALTER)|__new_/i.test(s))).toEqual([]);
    for (const s of SQL) await c.execute(s);
    await c.execute("INSERT INTO webinar_drafts (id, workspace_id, user_id, webinar_id, step, by_label) VALUES ('d1', 'ws', 'u', 'w1', 'foundation', 'Claude (connector)')");
    expect((await c.execute("SELECT section_key, fields, notes, status, decided_at FROM webinar_drafts")).rows[0]).toMatchObject({ section_key: "", fields: "{}", notes: "[]", status: "pending", decided_at: null });
    await c.execute("INSERT INTO webinar_history (id, workspace_id, user_id, webinar_id, action, by_label) VALUES ('h1', 'ws', 'u', 'w1', 'drafted', 'Claude (connector)')");
    expect((await c.execute("SELECT by_connector, changed, before, undone_at FROM webinar_history")).rows[0]).toMatchObject({ by_connector: 0, changed: "[]", before: null, undone_at: null });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0200_webinar_drafts");
    expect(at).toBe(journal.entries.length - 1);
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
