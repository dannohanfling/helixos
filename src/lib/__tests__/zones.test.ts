import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Times in each member's own zone (H-457, PR 2), on a real database of its own: a member who never had a zone gets their
 * browser's once, and from then on the viewer (which "today", the streak and the points day all read) is in that zone; a zone
 * already chosen, a coach switched in and a team member are never written over; Got it marks the line seen. And migration
 * 0236 adds the column, marking seen everyone who already has a zone.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-zones-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { viewerFor } = await import("@/lib/auth");
const { saveBrowserZone, markZoneNoticeSeen } = await import("@/lib/zones");

const W = "w-zones";
const member = async (id: string) => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, id) }))!;

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-zones", clientInviteCode: "CI-ZONES", coachInviteCode: "CO-ZONES", timezone: "America/Los_Angeles" });
  for (const [id, tz] of [["new", null], ["set", "Europe/London"]] as const) {
    await db.insert(schema.users).values({ id: `u-${id}`, email: `${id}@zones.test`, name: id, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: `u-${id}`, role: "client", timezone: tz });
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the browser's zone for a member who never had one", () => {
  it("before: the viewer stands in with the coach's zone", async () => {
    const v = (await viewerFor("u-new", W))!;
    expect(v.membership.timezone).toBeNull();
    expect(v.tz).toBe("America/Los_Angeles");
  });

  it("a coach switched in, a team member and a made-up zone write nothing", async () => {
    const v = (await viewerFor("u-new", W))!;
    expect(await saveBrowserZone({ ...v, switchedInto: { membershipId: v.membership.id } }, "Australia/Sydney")).toBe(false);
    expect(await saveBrowserZone({ ...v, team: { id: "t" } }, "Australia/Sydney")).toBe(false);
    expect(await saveBrowserZone(v, "+11:00")).toBe(false);
    expect((await member("m-new")).timezone).toBeNull();
  });

  it("is saved once, as the zone database writes it, and every read after uses it", async () => {
    const v = (await viewerFor("u-new", W))!;
    expect(await saveBrowserZone(v, "australia/sydney")).toBe(true);
    expect((await member("m-new")).timezone).toBe("Australia/Sydney");
    const after = (await viewerFor("u-new", W))!;
    // "Today", the streak and the points day all read the viewer's tz, which is the member's own column.
    expect(after.tz).toBe("Australia/Sydney");
    expect(after.tz).toBe(after.membership.timezone);
    // A second browser (a laptop in another zone) never moves it.
    expect(await saveBrowserZone(after, "America/New_York")).toBe(false);
    expect((await member("m-new")).timezone).toBe("Australia/Sydney");
  });

  it("never writes over a zone the member already has", async () => {
    const v = (await viewerFor("u-set", W))!;
    expect(await saveBrowserZone(v, "Australia/Sydney")).toBe(false);
    expect((await member("m-set")).timezone).toBe("Europe/London");
  });

  it("Got it marks the line seen; never for a coach switched in", async () => {
    const v = (await viewerFor("u-new", W))!;
    await markZoneNoticeSeen({ ...v, switchedInto: { membershipId: v.membership.id } });
    expect((await member("m-new")).tzPromptSeenAt).toBeNull();
    await markZoneNoticeSeen(v);
    expect((await member("m-new")).tzPromptSeenAt).toBeTruthy();
  });
});

const read = (f: string) =>
  readFileSync(path.join(process.cwd(), "drizzle", f), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("migration 0236: when the one-time zone line was seen", () => {
  it("adds one nullable column and marks seen only the members who already have a zone", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("CREATE TABLE memberships (id text PRIMARY KEY, timezone text)");
    await c.execute("INSERT INTO memberships (id, timezone) VALUES ('a', 'Australia/Sydney'), ('b', NULL)");
    for (const s of read("0236_tz_prompt_seen.sql")) await c.execute(s);
    const rows = (await c.execute("SELECT id, tz_prompt_seen_at FROM memberships ORDER BY id")).rows;
    expect(rows[0]!.tz_prompt_seen_at).toBeTruthy();
    expect(rows[1]!.tz_prompt_seen_at).toBeNull();
    expect((await c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) => r.name)).toEqual(["memberships"]);
  });

  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0236_tz_prompt_seen");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0236").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
