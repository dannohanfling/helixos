import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0207 (H-745): member_blocks, the Content report's target and Handled on member_reports, and a hidden win. */
const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0207: block a member, report a win", () => {
  it("creates member_blocks with one row per pair, adds plain columns to member_reports and colosseum_wins, and rebuilds nothing", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of read("0105_member_reports.sql").filter((s) => s.includes("member_reports"))) await c.execute(s);
    for (const s of read("0158_colosseum.sql").filter((s) => s.includes("colosseum_wins"))) await c.execute(s);
    await c.execute("INSERT INTO member_reports (id, workspace_id, user_id, kind, severity, description) VALUES ('r', 'w', 'u', 'issue', 'red', 'It broke')");
    await c.execute("INSERT INTO colosseum_wins (id, workspace_id, user_id, kind, text) VALUES ('win', 'w', 'u', 'business', 'Three calls booked')");
    const SQL = read("0207_block_report.sql");
    expect(SQL.filter((s) => /^(DROP|INSERT|UPDATE|DELETE)|__new_/i.test(s))).toEqual([]);
    for (const s of SQL) await c.execute(s);
    // Rows already there keep everything, the new columns empty.
    expect((await c.execute("SELECT kind, description, target_kind, target_id, target_user_id, handled_at FROM member_reports")).rows[0]).toMatchObject({ kind: "issue", description: "It broke", target_kind: null, target_id: null, target_user_id: null, handled_at: null });
    expect((await c.execute("SELECT text, hidden_at, hidden_by FROM colosseum_wins")).rows[0]).toMatchObject({ text: "Three calls booked", hidden_at: null, hidden_by: null });
    // One block per pair; the other direction is its own row.
    const block = "INSERT INTO member_blocks (id, workspace_id, blocker_membership_id, blocked_membership_id) VALUES (?, 'w', ?, ?)";
    await c.execute({ sql: block, args: ["b1", "m1", "m2"] });
    await expect(c.execute({ sql: block, args: ["b2", "m1", "m2"] })).rejects.toThrow(/UNIQUE/);
    await c.execute({ sql: block, args: ["b3", "m2", "m1"] });
    expect((await c.execute("SELECT created_at FROM member_blocks WHERE id = 'b1'")).rows[0]?.created_at).toBeTruthy();
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0207_block_report");
    expect(at).toBeGreaterThan(0);
    expect(journal.entries[at - 1]?.tag).toBe("0205_brand_kit_fields");
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  });
});
