import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 0248 (H-1859, plan H-1861 approved in H-1868): one table for moving a program's members to its new pass. */
const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0248_pass_switches.sql"), "utf8");

describe("migration 0248: pass switches", () => {
  it("creates pass_switches with its three indexes, and nothing else", () => {
    const statements = SQL.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/^CREATE TABLE `pass_switches`/);
    expect(statements[0]).not.toMatch(/email|name`/i);
    expect(statements.slice(1)).toEqual([
      "CREATE UNIQUE INDEX `pass_switches_token` ON `pass_switches` (`token`);",
      "CREATE UNIQUE INDEX `pass_switches_member` ON `pass_switches` (`feed_id`,`from_customer_id`);",
      "CREATE INDEX `pass_switches_feed` ON `pass_switches` (`feed_id`,`status`);",
    ]);
  });

  // 0247 is the Schedule board (H-1843), on its own branch: whichever lands first, 0248 follows the entry before it.
  it("follows the entry before it in the journal, with the next idx and a later timestamp", () => {
    const i = journal.entries.findIndex((e) => e.tag === "0248_pass_switches");
    expect(i).toBeGreaterThan(0);
    const prev = journal.entries[i - 1];
    expect(["0246_character_story_links", "0247_schedule_board"]).toContain(prev.tag);
    expect(journal.entries[i].idx).toBe(prev.idx + 1);
    expect(journal.entries[i].when).toBeGreaterThan(prev.when);
  });
});
