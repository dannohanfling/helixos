import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 0244 (H-1699, plan H-1701 approved in H-1702): Fix my pass, two switches on the program and one flag per member. */
const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0244_fix_my_pass.sql"), "utf8");

describe("migration 0244: fix my pass", () => {
  it("adds three booleans that default to false, and nothing else", () => {
    const statements = SQL.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual([
      "ALTER TABLE `leaderboard_feeds` ADD `name_fix_proven` integer DEFAULT false NOT NULL;",
      "ALTER TABLE `leaderboard_feeds` ADD `fix_names_on_change` integer DEFAULT false NOT NULL;",
      "ALTER TABLE `memberships` ADD `eo_name_needs_fix` integer DEFAULT false NOT NULL;",
    ]);
  });

  it("follows 0243_arena in the journal, with a later timestamp", () => {
    const i = journal.entries.findIndex((e) => e.tag === "0244_fix_my_pass");
    expect(i).toBeGreaterThan(0);
    const prev = journal.entries[i - 1];
    expect(prev.tag).toBe("0243_arena");
    expect(journal.entries[i].idx).toBe(prev.idx + 1);
    expect(journal.entries[i].when).toBeGreaterThan(prev.when);
  });
});
