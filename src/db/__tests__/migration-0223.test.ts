import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 0223 (H-1098, approved H-1100): the Tier last written to the pass, so each kept-rank change goes once. */
const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0223_tier_sent.sql"), "utf8").trim();

describe("migration 0223: the pass's Tier", () => {
  it("adds one nullable column and nothing else", () => {
    expect(SQL).toBe("ALTER TABLE `memberships` ADD `eo_tier_sent` text;");
  });

  it("follows 0222_rank_kept in the journal, with a later timestamp", () => {
    const i = journal.entries.findIndex((e) => e.tag === "0223_tier_sent");
    expect(i).toBeGreaterThan(0);
    const prev = journal.entries[i - 1];
    expect(prev.tag).toBe("0222_rank_kept");
    expect(journal.entries[i].idx).toBe(prev.idx + 1);
    expect(journal.entries[i].when).toBeGreaterThan(prev.when);
  });
});
