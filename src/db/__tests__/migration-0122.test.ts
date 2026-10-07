import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/**
 * Migration 0122 (Team access, Danno 6 Oct), applied to a database in the shape 0121 left: the seat cap arrives on every
 * membership at five, the three team tables exist, and one person can hold only one live row per owner (a removed row does
 * not block a new invite).
 */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0122_team_access.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

async function migrated() {
  const c = createClient({ url: ":memory:" });
  await c.executeMultiple(`
    CREATE TABLE memberships (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, user_id text NOT NULL, role text NOT NULL, removed_at text);
    INSERT INTO memberships (id, workspace_id, user_id, role) VALUES ('m1', 'w1', 'u1', 'client'), ('m2', 'w1', 'u2', 'coach');
  `);
  for (const s of SQL) await c.execute(s);
  return c;
}

describe("migration 0122: team access", () => {
  it("gives every existing member five seats and makes the three team tables", async () => {
    const c = await migrated();
    expect((await c.execute("SELECT id, team_cap FROM memberships ORDER BY id")).rows.map((r) => [r.id, r.team_cap])).toEqual([["m1", 5], ["m2", 5]]);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["team_changes", "team_invites", "team_members"]));
    expect(SQL.join("\n")).not.toMatch(/__new_/);
  });
  it("allows one live row per person per owner, and a new row once the old one is removed", async () => {
    const c = await migrated();
    const row = (id: string, removed: string | null) => c.execute({ sql: "INSERT INTO team_members (id, workspace_id, owner_membership_id, user_id, team_user_id, added_by, removed_at) VALUES (?, 'w1', 'm1', 'u1', 'sam', 'u1', ?)", args: [id, removed] });
    await row("t1", null);
    await expect(row("t2", null)).rejects.toThrow(/UNIQUE/);
    await c.execute("UPDATE team_members SET removed_at = '2026-10-07T00:00:00Z' WHERE id = 't1'");
    await row("t3", null);
    expect((await c.execute("SELECT count(*) AS n FROM team_members")).rows[0].n).toBe(2);
    // The same person on another owner's team is a different row.
    await c.execute("INSERT INTO team_members (id, workspace_id, owner_membership_id, user_id, team_user_id, added_by) VALUES ('t4', 'w1', 'm2', 'u2', 'sam', 'u2')");
  });
  it("keeps one invite per code", async () => {
    const c = await migrated();
    await c.execute("INSERT INTO team_invites (id, workspace_id, owner_membership_id, user_id, created_by, code_hash, expires_at) VALUES ('i1', 'w1', 'm1', 'u1', 'u1', 'h', '2026-10-14T00:00:00Z')");
    await expect(c.execute("INSERT INTO team_invites (id, workspace_id, owner_membership_id, user_id, created_by, code_hash, expires_at) VALUES ('i2', 'w1', 'm1', 'u1', 'u1', 'h', '2026-10-14T00:00:00Z')")).rejects.toThrow(/UNIQUE/);
  });
});
