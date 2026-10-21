import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0222 (H-1088, plan H-1093): the kept rank, backfilled once from the old thresholds before the new ones apply. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0222_rank_kept.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0222: the kept rank", () => {
  it("adds one column, then backfills it", () => {
    expect(SQL[0]).toBe("ALTER TABLE `memberships` ADD `rank_kept_level` integer;");
    expect(SQL).toHaveLength(2);
  });

  it("backfills each membership's rank under the old thresholds, or its celebrated rank if higher", async () => {
    const db = createClient({ url: ":memory:" });
    await db.execute("CREATE TABLE memberships (id text, workspace_id text, user_id text, celebrated_tier_level integer)");
    await db.execute("CREATE TABLE points_ledger (id text, workspace_id text, user_id text, points integer)");
    const people: [string, number[], number | null][] = [
      ["new", [], null],
      ["sage", [300, 300], 3],
      ["sentinel-3181", [3000, 181], 5],
      ["alchemist-1800", [1800], null],
      ["olympian", [60000], null],
      ["celebrated-higher", [200], 4],
    ];
    for (const [id, pts, celebrated] of people) {
      await db.execute({ sql: "INSERT INTO memberships VALUES (?, 'w', ?, ?)", args: [id, id, celebrated] });
      for (const p of pts) await db.execute({ sql: "INSERT INTO points_ledger VALUES (?, 'w', ?, ?)", args: [`${id}-${p}`, id, p] });
    }
    // Another workspace's points never count.
    await db.execute("INSERT INTO points_ledger VALUES ('x', 'other', 'new', 99999)");
    for (const s of SQL) await db.execute(s);
    const rows = await db.execute("SELECT id, rank_kept_level AS k FROM memberships ORDER BY id");
    const kept = Object.fromEntries(rows.rows.map((r) => [r.id as string, Number(r.k)]));
    expect(kept).toEqual({ new: 1, sage: 3, "sentinel-3181": 5, "alchemist-1800": 4, olympian: 9, "celebrated-higher": 4 });
  });

  it("follows main's 0212 in the journal, with a later time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0222_rank_kept");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0212_block_report");
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  });
});
