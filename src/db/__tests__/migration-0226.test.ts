import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0226 (H-1262, plan H-1270): the coach's frameworks, one row a slug per workspace. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0226_frameworks.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0226: frameworks", () => {
  it("adds one table with its two indexes, rebuilding nothing", () => {
    expect(SQL.some((s) => s.startsWith("CREATE TABLE `frameworks`"))).toBe(true);
    expect(SQL).toContain("CREATE UNIQUE INDEX `frameworks_workspace_slug` ON `frameworks` (`workspace_id`,`slug`);");
    expect(SQL).toContain("CREATE INDEX `frameworks_workspace_status` ON `frameworks` (`workspace_id`,`status`);");
    expect(SQL.some((s) => /__new_|DROP TABLE|ALTER TABLE/.test(s))).toBe(false);
  });
  it("refuses the same slug twice in one workspace, and allows it in another", async () => {
    const db = createClient({ url: ":memory:" });
    for (const s of SQL) await db.execute(s);
    await db.execute("INSERT INTO frameworks (id, workspace_id, slug, name, idea, digest) VALUES ('a', 'w1', 'x', 'X', 'i', 'd')");
    await expect(db.execute("INSERT INTO frameworks (id, workspace_id, slug, name, idea, digest) VALUES ('b', 'w1', 'x', 'X', 'i', 'd')")).rejects.toThrow();
    await db.execute("INSERT INTO frameworks (id, workspace_id, slug, name, idea, digest) VALUES ('c', 'w2', 'x', 'X', 'i', 'd')");
    const row = (await db.execute("SELECT status, steps, has_price FROM frameworks WHERE id = 'a'")).rows[0];
    expect(row.status).toBe("draft");
    expect(row.steps).toBe("[]");
    expect(row.has_price).toBe(0);
  });
  it("follows 0225 in the journal, with a later time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0226_frameworks");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1].tag).toBe("0225_applause");
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
    // Later migrations may follow it once they merge; every one keeps a later time than the one before.
    for (let i = at + 1; i < journal.entries.length; i++) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
  });
});
