import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { DEFAULT_CALLS, DEFAULT_CALLS_LINK, DEFAULT_CALLS_PASSCODE } from "@/lib/engine/calls";

/** Migration 0211 (H-820, plan H-828): the weekly calls, their skipped dates, the shared link and passcode, and the usual week for every workspace with a coach. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0211: the weekly calls", () => {
  it("adds the two tables and two columns, and gives each workspace with a coach the usual week, matching the engine's defaults", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE `workspaces` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL)");
    await c.execute("CREATE TABLE `memberships` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL, `user_id` text NOT NULL, `role` text NOT NULL, `removed_at` text)");
    await c.execute("INSERT INTO workspaces (id, name) VALUES ('w1', 'With a coach'), ('w2', 'No coach'), ('w3', 'Coach removed')");
    await c.execute("INSERT INTO memberships (id, workspace_id, user_id, role, removed_at) VALUES ('m1', 'w1', 'u1', 'coach', NULL), ('m2', 'w1', 'u2', 'client', NULL), ('m3', 'w2', 'u3', 'client', NULL), ('m4', 'w3', 'u4', 'coach', '2026-01-01')");
    const SQL = read("0211_calls.sql");
    for (const s of SQL) await c.execute(s);
    const rows = (await c.execute("SELECT workspace_id, name, weekday, start, minutes, timezone, audience, link, active, sort FROM program_calls ORDER BY workspace_id, sort")).rows;
    expect(rows.map((r) => r.workspace_id)).toEqual(DEFAULT_CALLS.map(() => "w1"));
    expect(rows.map((r) => ({ name: r.name, weekday: r.weekday, start: r.start, minutes: r.minutes, timezone: r.timezone, audience: r.audience, sort: r.sort }))).toEqual(DEFAULT_CALLS);
    expect(rows.every((r) => r.link === null && r.active === 1)).toBe(true);
    const ws = (await c.execute("SELECT id, calls_link, calls_passcode FROM workspaces ORDER BY id")).rows;
    expect(ws.map((r) => [r.id, r.calls_link, r.calls_passcode])).toEqual([
      ["w1", DEFAULT_CALLS_LINK, DEFAULT_CALLS_PASSCODE],
      ["w2", null, null],
      ["w3", null, null],
    ]);
    // A skip is one per call and date.
    const id = rows.length ? (await c.execute("SELECT id FROM program_calls LIMIT 1")).rows[0].id : "";
    await c.execute({ sql: "INSERT INTO program_call_skips (id, call_id, date, note) VALUES ('s1', ?, '2026-11-26', 'Holiday')", args: [id] });
    await expect(c.execute({ sql: "INSERT INTO program_call_skips (id, call_id, date) VALUES ('s2', ?, '2026-11-26')", args: [id] })).rejects.toThrow(/UNIQUE/);
  });
  it("follows 0202 on main in the journal, with a later timestamp", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0211_calls");
    expect(journal.entries[at - 1]?.tag).toBe("0209_points_sync");
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
