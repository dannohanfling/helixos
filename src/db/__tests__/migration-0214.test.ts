import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0214 (H-811 B1): a lead colour on each pathway, empty until the member sets one. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0214: a pathway's lead colour", () => {
  it("adds one nullable column to pathways and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE pathways (id text PRIMARY KEY, workspace_id text NOT NULL, user_id text NOT NULL, name text NOT NULL)");
    await c.execute("INSERT INTO pathways (id, workspace_id, user_id, name) VALUES ('p', 'w', 'u', 'Business')");
    const SQL = read("0214_pathway_lead_color.sql");
    expect(SQL).toEqual(["ALTER TABLE `pathways` ADD `lead_color` text;"]);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT name, lead_color FROM pathways")).rows[0]).toMatchObject({ name: "Business", lead_color: null });
    expect((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => r.name)).toEqual(["pathways"]);
  });

  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0214_pathway_lead_color");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0214").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
