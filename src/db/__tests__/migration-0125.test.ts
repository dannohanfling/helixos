import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0125 (Danno's Proof Bank from Airtable, 8 Oct): the call title, the tags and the Airtable id on proofs, one id per member. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0125_proof_bank_airtable.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0125: proof bank from airtable", () => {
  it("adds the columns with empty tags on every existing proof, and refuses the same Airtable row twice for one member", async () => {
    const c = createClient({ url: ":memory:" });
    await c.executeMultiple(`
      CREATE TABLE proofs (id text PRIMARY KEY NOT NULL, user_id text NOT NULL, name text NOT NULL);
      INSERT INTO proofs (id, user_id, name) VALUES ('p1', 'u1', 'Sarah: 11 lbs');
    `);
    for (const s of SQL) await c.execute(s);
    expect((await c.execute("SELECT tags, airtable_id, source_title FROM proofs")).rows.map((r) => [r.tags, r.airtable_id, r.source_title])).toEqual([["[]", null, null]]);
    await c.execute("INSERT INTO proofs (id, user_id, name, airtable_id) VALUES ('p2', 'u1', 'A', 'rec1'), ('p3', 'u2', 'B', 'rec1')");
    await expect(c.execute("INSERT INTO proofs (id, user_id, name, airtable_id) VALUES ('p4', 'u1', 'C', 'rec1')")).rejects.toThrow();
  });
});
