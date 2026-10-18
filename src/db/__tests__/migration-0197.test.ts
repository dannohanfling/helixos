import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0197 (H-457): the Office Hours session as a weekday, a start in the host's zone and a length, on workspaces. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0197: the Office Hours session's day, start and length", () => {
  it("adds three columns with Friday, no start and 60 minutes on every existing workspace, keeps the note, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE workspaces (id text PRIMARY KEY NOT NULL, name text NOT NULL, ooh_time text, ooh_link text)");
    await c.execute("INSERT INTO workspaces (id, name, ooh_time) VALUES ('w1', 'Walk', 'Fridays at 12:00 pm')");
    const SQL = read("0197_ooh_session.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE)|__new_/i.test(s))).toEqual([]);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT ooh_weekday, ooh_start, ooh_minutes, ooh_time FROM workspaces")).rows[0]).toMatchObject({ ooh_weekday: 5, ooh_start: null, ooh_minutes: 60, ooh_time: "Fridays at 12:00 pm" });
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0197_ooh_session");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0196_aqueduct_repair");
  });
});
