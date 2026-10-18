import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0205 (H-811): the brand kit's spelling (American by default), legal name, descriptor, and its hold switch (off). */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0205: the brand kit's spelling, legal name and descriptor", () => {
  it("adds four columns to brand_kits, each nullable or defaulted, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE brand_kits (id text PRIMARY KEY, workspace_id text NOT NULL, user_id text NOT NULL, name text NOT NULL)");
    await c.execute("INSERT INTO brand_kits (id, workspace_id, user_id, name) VALUES ('k', 'w', 'u', 'Mine')");
    const SQL = read("0205_brand_kit_fields.sql");
    expect(SQL).toEqual([
      "ALTER TABLE `brand_kits` ADD `spelling` text DEFAULT 'us' NOT NULL;",
      "ALTER TABLE `brand_kits` ADD `legal_name` text;",
      "ALTER TABLE `brand_kits` ADD `descriptor` text;",
      "ALTER TABLE `brand_kits` ADD `descriptor_hidden` integer DEFAULT false NOT NULL;",
    ]);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT spelling, legal_name, descriptor, descriptor_hidden FROM brand_kits")).rows[0]).toMatchObject({ spelling: "us", legal_name: null, descriptor: null, descriptor_hidden: 0 });
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(["brand_kits"]);
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0205_brand_kit_fields");
    expect(journal.entries[at - 1]?.tag).toBe("0202_eo_pass");
    expect(journal.entries[at]!.when).toBeGreaterThan(journal.entries[at - 1]!.when);
  });
});
