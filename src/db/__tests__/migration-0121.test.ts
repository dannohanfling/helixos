import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/**
 * Migration 0121 (rev 568): the brand kit becomes one per member. Applied here to a database in the shape 0120 left, with the
 * cases the backfill has to get right: the kit a coach saved while switched into a client (its logo is the client's) goes to
 * that client and the coach gets a copy, named for the coach's business, with no logo; a kit with no logo goes to the coach;
 * a kit in a workspace with no coach and no logo is dropped rather than left with no owner.
 */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0121_member_brand_kits.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

async function before() {
  const c = createClient({ url: ":memory:" });
  await c.executeMultiple(`
    CREATE TABLE workspaces (id text PRIMARY KEY NOT NULL, name text NOT NULL);
    CREATE TABLE memberships (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, user_id text NOT NULL, role text NOT NULL, business_name text, removed_at text, started_at text NOT NULL DEFAULT (date('now')));
    CREATE TABLE deck_images (id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, user_id text NOT NULL, kind text NOT NULL);
    CREATE TABLE brand_kits (
      id text PRIMARY KEY NOT NULL, workspace_id text NOT NULL, name text NOT NULL, ground text NOT NULL, ink text NOT NULL, accent text NOT NULL,
      muted text NOT NULL, surface text NOT NULL, inverse_ground text, inverse_ink text, display_font text NOT NULL, body_font text NOT NULL,
      quote_font text, font_fallback text DEFAULT 'Arial' NOT NULL, banned_colors text DEFAULT '[]' NOT NULL, notes text,
      created_at text DEFAULT (datetime('now')) NOT NULL, placeholder text, aliases text DEFAULT '[]' NOT NULL,
      show_price_anchor integer DEFAULT true NOT NULL, logo_image_id text, logo_dark_image_id text
    );
    CREATE UNIQUE INDEX brand_kits_workspace_id_unique ON brand_kits (workspace_id);
    INSERT INTO workspaces VALUES ('w1', 'Evolve Omega Academy'), ('w2', 'Second'), ('w3', 'No coach');
    INSERT INTO memberships (id, workspace_id, user_id, role, business_name, removed_at, started_at) VALUES
      ('m-danno', 'w1', 'danno', 'coach', 'Evolve Omega', NULL, '2025-01-01'),
      ('m-old', 'w1', 'old-coach', 'coach', NULL, '2025-06-01', '2024-01-01'),
      ('m-rooted', 'w1', 'rooted', 'client', 'Rooted Rest', NULL, '2025-09-01'),
      ('m-kim', 'w1', 'kim', 'client', 'Kim Co', NULL, '2025-09-02'),
      ('m-c2', 'w2', 'coach2', 'coach', '', NULL, '2025-01-01'),
      ('m-c3', 'w3', 'someone', 'client', NULL, NULL, '2025-01-01');
    INSERT INTO deck_images VALUES ('logo-rooted', 'w1', 'rooted', 'logo');
    INSERT INTO brand_kits (id, workspace_id, name, ground, ink, accent, muted, surface, display_font, body_font, aliases, logo_image_id, notes) VALUES
      ('k1', 'w1', 'Rooted Rest', 'FAF8F5', '6E6256', 'DD2727', '4B5563', 'ECE9E5', 'Red Hat Display', 'Helvetica', '["Turas"]', 'logo-rooted', 'kept'),
      ('k2', 'w2', 'Second kit', 'FFFFFF', '111111', '555555', '555555', 'F2F2F2', 'Arial', 'Arial', '[]', NULL, NULL),
      ('k3', 'w3', 'Orphan', 'FFFFFF', '111111', '555555', '555555', 'F2F2F2', 'Arial', 'Arial', '[]', NULL, NULL);
  `);
  for (const s of SQL) await c.execute(s);
  return c;
}

describe("migration 0121: a brand kit per member", () => {
  it("gives the kit saved while switched into a client to that client, and the coach a copy named for their business with no logo", async () => {
    const c = await before();
    const rows = (await c.execute("SELECT id, user_id, name, ground, aliases, logo_image_id, notes FROM brand_kits WHERE workspace_id = 'w1' ORDER BY user_id")).rows;
    expect(rows.map((r) => [r.user_id, r.name, r.logo_image_id])).toEqual([
      ["danno", "Evolve Omega", null],
      ["rooted", "Rooted Rest", "logo-rooted"],
    ]);
    // The copy keeps the colours, the permitted names and the notes; its id is new.
    const copy = rows.find((r) => r.user_id === "danno")!;
    expect([copy.ground, copy.aliases, copy.notes]).toEqual(["FAF8F5", '["Turas"]', "kept"]);
    expect(copy.id).not.toBe("k1");
    // The removed coach and the other client get nothing: they start on the starter kit.
    expect(rows.some((r) => r.user_id === "old-coach" || r.user_id === "kim")).toBe(false);
  });
  it("gives a kit with no logo to the workspace's coach, named as it was, and makes no copy", async () => {
    const c = await before();
    const rows = (await c.execute("SELECT user_id, name FROM brand_kits WHERE workspace_id = 'w2'")).rows;
    expect(rows).toEqual([{ user_id: "coach2", name: "Second kit" }]);
  });
  it("drops a kit nobody can own, and leaves one kit per member enforced", async () => {
    const c = await before();
    expect((await c.execute("SELECT count(*) AS n FROM brand_kits WHERE workspace_id = 'w3'")).rows[0].n).toBe(0);
    await expect(c.execute("INSERT INTO brand_kits (id, workspace_id, user_id, name, ground, ink, accent, muted, surface, display_font, body_font) VALUES ('dup', 'w1', 'rooted', 'x', 'a', 'b', 'c', 'd', 'e', 'f', 'g')")).rejects.toThrow(/UNIQUE/);
    // Two members in one workspace, each with their own: allowed.
    await c.execute("INSERT INTO brand_kits (id, workspace_id, user_id, name, ground, ink, accent, muted, surface, display_font, body_font) VALUES ('kim', 'w1', 'kim', 'Kim Co', 'a', 'b', 'c', 'd', 'e', 'f', 'g')");
    expect((await c.execute("SELECT count(*) AS n FROM brand_kits WHERE workspace_id = 'w1'")).rows[0].n).toBe(3);
  });
});
