import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 0209 (H-867): the points sync's modes and links, the member's last Level and invitations, the ledger's mirrored flag. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0209: the points sync", () => {
  it("only adds columns, each with a default that leaves today's behaviour unchanged", () => {
    const SQL = read("0209_points_sync.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE)|__new_/i.test(s))).toEqual([]);
    expect(SQL).toEqual([
      "ALTER TABLE `leaderboard_feeds` ADD `sync_mode` text DEFAULT 'off' NOT NULL;",
      "ALTER TABLE `leaderboard_feeds` ADD `invite_mode` text DEFAULT 'off' NOT NULL;",
      "ALTER TABLE `leaderboard_feeds` ADD `invite_links` text DEFAULT '{}' NOT NULL;",
      "ALTER TABLE `memberships` ADD `eo_level_sent` text;",
      "ALTER TABLE `memberships` ADD `eo_offers_sent` text DEFAULT '[]' NOT NULL;",
      "ALTER TABLE `points_ledger` ADD `eo_mirrored` integer DEFAULT false NOT NULL;",
    ]);
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0209_points_sync");
    expect(journal.entries[at - 1]?.tag).toBe("0205_brand_kit_fields");
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
