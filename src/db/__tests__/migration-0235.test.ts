import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { schema } from "@/db";

/** Migration 0235 (H-922 item 1, plan H-1130, option A): the evening reminder moves from the old 5 PM default to 7 PM. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0235: the evening reminder at 7 PM", () => {
  it("moves only the members still on the old 5 PM default; a chosen hour stays", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE `memberships` (`id` text PRIMARY KEY NOT NULL, `evening_reminder_hour` integer DEFAULT 17 NOT NULL)");
    await c.execute("INSERT INTO memberships (id, evening_reminder_hour) VALUES ('default', 17), ('early', 16), ('late', 20), ('already', 19)");
    for (const s of read("0235_evening_7pm.sql")) await c.execute(s);
    const rows = (await c.execute("SELECT id, evening_reminder_hour AS h FROM memberships ORDER BY id")).rows.map((r) => [r.id, r.h]);
    expect(rows).toEqual([
      ["already", 19],
      ["default", 19],
      ["early", 16],
      ["late", 20],
    ]);
  });
  it("new members start at 7 PM: the app writes 19 itself, so the table needs no rebuild", () => {
    const col = getTableConfig(schema.memberships).columns.find((x) => x.name === "evening_reminder_hour")!;
    expect(col.default).toBe(19);
    expect(read("0235_evening_7pm.sql").join("\n")).not.toMatch(/CREATE TABLE|__new_memberships/);
  });
  it("follows the migrations already on main in the journal, with a later timestamp", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0235_evening_7pm");
    // Later migrations may follow it once they merge; every one keeps a later time than the one before.
    for (let i = at + 1; i < journal.entries.length; i++) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  });
});
