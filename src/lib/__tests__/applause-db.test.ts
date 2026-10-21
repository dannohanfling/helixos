import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Applause on Colosseum wins (H-1171, plan H-1177), against a real database: every migration applied to a throwaway file.
 * One workspace: the coach, Ana and Leo (who applaud), Mia (whose wins they applaud), and Hid, who hides from the arena.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-applause-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});
// Nothing leaves the test: the points push to outside systems is a no-op here.
vi.mock("@/lib/integrations", async (orig) => ({ ...(await orig<object>()), background: () => undefined, pushPoints: async () => undefined }));

const { db, schema } = await import("@/db");
const { eq, and } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { applaud, applauseOn, applauseNews, markApplauseSeen, takeDownApplause, shareApplausePoints, unshareApplausePoints } = await import("@/lib/applause");
const { NO_BLOCKS } = await import("@/lib/engine/blocks");
const { planErase } = await import("@/lib/erase");

const W = "ws1";
const TZ = "UTC";
const person = (id: string, name: string, role: "coach" | "client") => ({ id: `u-${id}`, name, role, membershipId: `m-${id}` });
const coach = person("coach", "Danno Hanfling", "coach");
const ana = person("ana", "Ana Ruiz", "client");
const leo = person("leo", "Leo Tolstoy", "client");
const mia = person("mia", "Mia Wong", "client");
const hid = person("hid", "Hid Den", "client");
const who = (p: ReturnType<typeof person>) => ({ workspaceId: W, userId: p.id, role: p.role, tz: TZ, firstName: p.name.split(" ")[0] });
const points = async (p: ReturnType<typeof person>, prefix = "") =>
  (await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.workspaceId, W), eq(schema.pointsLedger.userId, p.id)) }))
    .filter((r) => (r.refId ?? "").startsWith(prefix) && r.type === "community")
    .reduce((t, r) => t + r.points, 0);
const reasonsOf = async (p: ReturnType<typeof person>) => (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, p.id) })).map((r) => r.reason);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1", colosseumOn: true });
  for (const p of [coach, ana, leo, mia, hid]) {
    await db.insert(schema.users).values({ id: p.id, email: `${p.id}@example.test`, name: p.name, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: p.membershipId, workspaceId: W, userId: p.id, role: p.role, arenaHidden: p === hid });
  }
  for (let i = 1; i <= 8; i++) await db.insert(schema.colosseumWins).values({ id: `w${i}`, workspaceId: W, userId: mia.id, kind: "business", text: `Mia's win number ${i}` });
  await db.insert(schema.colosseumWins).values({ id: "w-ana", workspaceId: W, userId: ana.id, kind: "community", text: "Ana's own win" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("applause (H-1177)", () => {
  it("one applause per person per win; never on your own win", async () => {
    expect(await applaud(who(ana), "w1", true, NO_BLOCKS)).toEqual({ ok: true, on: true });
    expect(await applaud(who(ana), "w1", true, NO_BLOCKS)).toEqual({ ok: true, on: true });
    expect((await db.query.winApplause.findMany({ where: eq(schema.winApplause.winId, "w1") })).length).toBe(1);
    expect(await applaud(who(ana), "w-ana", true, NO_BLOCKS)).toMatchObject({ ok: false });
    expect(await points(ana, "applaud:")).toBe(2);
    expect(await points(mia, "applauded:")).toBe(5);
    expect(await reasonsOf(ana)).toContain("Applauded a win");
    expect(await reasonsOf(mia)).toContain("Your win was applauded");
  });

  it("the applauder earns at most 10 a day", async () => {
    for (const w of ["w2", "w3", "w4", "w5", "w6", "w7"]) await applaud(who(ana), w, true, NO_BLOCKS);
    expect(await points(ana, "applaud:")).toBe(10);
  });

  it("the coach gives +10, named, and earns nothing; the winner earns at most 25 a win", async () => {
    await applaud(who(coach), "w8", true, NO_BLOCKS);
    expect(await points(coach)).toBe(0);
    expect(await reasonsOf(mia)).toContain("Danno applauded your win");
    expect(await points(mia, "applauded:w8:")).toBe(10);
    for (const p of [ana, leo, hid]) await applaud(who(p), "w8", true, NO_BLOCKS);
    // 10 + 5 + 5 + 5 = 25: the last stays at the cap.
    expect(await points(mia, "applauded:w8:")).toBe(25);
  });

  it("undo the same day takes the points back as minus rows; the ledger keeps every row", async () => {
    const before = { leo: await points(leo), mia: await points(mia) };
    await applaud(who(leo), "w1", true, NO_BLOCKS);
    expect(await points(leo)).toBe(before.leo + 2);
    expect(await applaud(who(leo), "w1", false, NO_BLOCKS)).toEqual({ ok: true, on: false });
    expect(await points(leo)).toBe(before.leo);
    expect(await points(mia)).toBe(before.mia);
    expect((await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, leo.id) })).some((r) => r.points < 0)).toBe(true);
    // Applauding again the same day earns nothing more: the key is spent.
    await applaud(who(leo), "w1", true, NO_BLOCKS);
    expect(await points(leo)).toBe(before.leo);
  });

  it("who applauded: first names, 'You' for the viewer, 'A member' for one who hides or is blocked", async () => {
    const a = (await applauseOn(W, ["w8"], ana.id, NO_BLOCKS)).get("w8")!;
    expect(a.count).toBe(4);
    expect(a.mine).toBe(true);
    expect(a.who).toEqual(expect.arrayContaining(["You", "Danno H.", "Leo T.", "A member"]));
    const blocked = (await applauseOn(W, ["w8"], mia.id, { memberships: new Set([leo.membershipId]), users: new Set([leo.id]), wins: new Set() })).get("w8")!;
    expect(blocked.who).not.toContain("Leo T.");
  });

  it("Today's line groups the newest win's applause, and closes", async () => {
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mia.membershipId) }))!;
    const news = await applauseNews({ workspace: { id: W }, user: { id: mia.id }, membership: { applauseSeenAt: m.applauseSeenAt } });
    expect(news?.line).toMatch(/applauded your win: Mia's win number/);
    await markApplauseSeen(mia.membershipId);
    const after = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mia.membershipId) }))!;
    expect(await applauseNews({ workspace: { id: W }, user: { id: mia.id }, membership: { applauseSeenAt: after.applauseSeenAt } })).toBeNull();
  });

  it("a win taken down: the winner's applause points on it come off, the applauders keep theirs", async () => {
    const anaBefore = await points(ana);
    await takeDownApplause({ workspaceId: W, userId: mia.id }, "w8");
    expect(await points(mia, "applauded:w8:") + (await points(mia, "win-down:w8"))).toBe(0);
    expect(await points(ana)).toBe(anaBefore);
    expect((await db.query.winApplause.findMany({ where: eq(schema.winApplause.winId, "w8") })).length).toBe(0);
  });

  it("sharing a win earns 10 once a day, and comes back off if today's only shared win comes down", async () => {
    const m = { workspaceId: W, userId: leo.id };
    await shareApplausePoints(m, TZ);
    await shareApplausePoints(m, TZ);
    expect(await points(leo, "win-share:")).toBe(10);
    await db.insert(schema.colosseumWins).values({ id: "w-leo", workspaceId: W, userId: leo.id, kind: "business", text: "Leo's win" });
    const win = (await db.query.colosseumWins.findFirst({ where: eq(schema.colosseumWins.id, "w-leo") }))!;
    await db.delete(schema.colosseumWins).where(eq(schema.colosseumWins.id, "w-leo"));
    await unshareApplausePoints(m, TZ, win);
    expect((await points(leo, "win-share:")) + (await points(leo, "win-unshare:"))).toBe(0);
  });

  it("erasing a member takes their applause and the applause on their wins", async () => {
    const plan = (await planErase(W, mia.membershipId))!;
    const onMia = await db.query.winApplause.findMany({ where: eq(schema.winApplause.winId, "w1") });
    expect(onMia.length).toBeGreaterThan(0);
    expect(plan.ids.win_applause).toEqual(expect.arrayContaining(onMia.map((r) => r.id)));
    const anaPlan = (await planErase(W, ana.membershipId))!;
    const anaGave = await db.query.winApplause.findMany({ where: eq(schema.winApplause.userId, ana.id) });
    expect(anaPlan.ids.win_applause).toEqual(expect.arrayContaining(anaGave.map((r) => r.id)));
  });
});
