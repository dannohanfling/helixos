import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 0210 (H-934, plan H-942): the rank whose relic clip the member has seen, empty for everyone to start. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0210_rank_clip_seen.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0210: the relic clip seen", () => {
  it("adds one plain column to memberships and changes no row", () => {
    expect(SQL).toEqual(["ALTER TABLE `memberships` ADD `rank_clip_seen_level` integer;"]);
  });

  it("follows main's 0209 in the journal, with a later time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0210_rank_clip_seen");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0209_points_sync");
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  });
});
