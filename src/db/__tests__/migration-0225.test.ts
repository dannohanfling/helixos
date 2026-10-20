import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0225 (H-1171, plan H-1177): applause on Colosseum wins, one per person per win, and when Today's line was closed. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0225_applause.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0225: applause", () => {
  it("adds one table with its two indexes and one column, rebuilding nothing", () => {
    expect(SQL.some((s) => s.startsWith("CREATE TABLE `win_applause`"))).toBe(true);
    expect(SQL).toContain("CREATE UNIQUE INDEX `win_applause_once` ON `win_applause` (`win_id`,`user_id`);");
    expect(SQL).toContain("ALTER TABLE `memberships` ADD `applause_seen_at` text;");
    expect(SQL.some((s) => /__new_|DROP TABLE/.test(s))).toBe(false);
  });

  it("refuses a second applause by the same person on the same win", async () => {
    const db = createClient({ url: ":memory:" });
    await db.execute("CREATE TABLE memberships (id text)");
    for (const s of SQL) await db.execute(s);
    await db.execute("INSERT INTO win_applause (id, workspace_id, win_id, user_id) VALUES ('a', 'w', 'win', 'u')");
    await expect(db.execute("INSERT INTO win_applause (id, workspace_id, win_id, user_id) VALUES ('b', 'w', 'win', 'u')")).rejects.toThrow();
    await db.execute("INSERT INTO win_applause (id, workspace_id, win_id, user_id) VALUES ('c', 'w', 'win', 'v')");
  });

  it("follows main's earlier migrations in the journal, with a later time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0225_applause");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1].tag < "0225").toBe(true);
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
    // Later migrations may follow it once they merge (0226 does); every one keeps a later time than the one before.
    for (let i = at + 1; i < journal.entries.length; i++) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
  });
});
