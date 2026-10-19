import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Block a member and report a win (H-745), against a real database: every migration applied to a throwaway file, then the
 * feeds read the way the pages read them. One workspace: the coach, Ana (who blocks and reports), Leo and Mia.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-blocks-"));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@/db/schema");
  const db = drizzle(createClient({ url: `file:${path.join(dir, "t.db")}` }), { schema });
  return { db, schema };
});

const { db, schema } = await import("@/db");
const { migrate } = await import("drizzle-orm/libsql/migrator");
const { blockedFor, blockMember, unblockMember, reportContent, setWinHidden, blockedList, myReports } = await import("@/lib/blocks");
const { arenaFor, seatsOf, shareWin } = await import("@/lib/colosseum");
const { planErase, eraseMember } = await import("@/lib/erase");
const { WIN_REFUSED } = await import("@/lib/engine/word-filter");
const { A_MEMBER } = await import("@/lib/engine/blocks");

const W = "ws1";
const person = (id: string, name: string, role: "coach" | "client") => ({ user: { id: `u-${id}`, name }, membership: { id: `m-${id}`, role } });
const coach = person("coach", "Danno Hanfling", "coach");
const ana = person("ana", "Ana Ruiz", "client");
const leo = person("leo", "Leo Tolstoy", "client");
const mia = person("mia", "Mia Wong", "client");
const viewerOf = (p: ReturnType<typeof person>, extra: { switchedInto?: unknown } = {}) =>
  ({ workspace: { id: W, colosseumOn: true }, user: { id: p.user.id }, membership: { id: p.membership.id, arenaHidden: false, arenaPhoto: false, arenaPaused: false }, switchedInto: extra.switchedInto ?? null, team: null }) as never;
const arena = async (p: ReturnType<typeof person>, extra: { switchedInto?: unknown } = {}) => arenaFor(viewerOf(p, extra), "2026-10-18", await blockedFor(viewerOf(p, extra)));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.workspaces).values({ id: W, name: "Evolve", slug: "evolve", clientInviteCode: "C1", coachInviteCode: "K1", colosseumOn: true });
  await db.insert(schema.workspaces).values({ id: "ws2", name: "Other", slug: "other", clientInviteCode: "C2", coachInviteCode: "K2" });
  for (const p of [coach, ana, leo, mia]) {
    await db.insert(schema.users).values({ id: p.user.id, email: `${p.user.id}@example.test`, name: p.user.name, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: p.membership.id, workspaceId: W, userId: p.user.id, role: p.membership.role, arenaPhoto: true, headshotUrl: "https://store.example/x.jpg" });
    await db.insert(schema.pointsLedger).values({ id: `p-${p.user.id}`, workspaceId: W, userId: p.user.id, points: 50, type: "bonus", reason: "Welcome" });
  }
  await db.insert(schema.users).values({ id: "u-out", email: "out@example.test", name: "Out Sider", passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: "m-out", workspaceId: "ws2", userId: "u-out", role: "client" });
  for (const [id, p, text] of [["w-leo", leo, "Two calls booked"], ["w-mia", mia, "First client signed"], ["w-coach", coach, "Ran the Friday call"]] as const) {
    await db.insert(schema.colosseumWins).values({ id, workspaceId: W, userId: p.user.id, kind: "business", text });
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("block a member (H-745)", () => {
  it("a member can't block their coach, themselves, or someone from another workspace", async () => {
    expect(await blockMember(viewerOf(ana), coach.membership.id)).toMatchObject({ ok: false, error: expect.stringMatching(/coach can't be blocked/) });
    expect((await blockMember(viewerOf(ana), ana.membership.id)).ok).toBe(false);
    expect((await blockMember(viewerOf(ana), "m-out")).ok).toBe(false);
    expect((await blockedFor(viewerOf(ana))).memberships.size).toBe(0);
  });

  it("the blocker loses the member's wins; the seat stays as 'A member' with no photo; nobody else changes", async () => {
    expect(await blockMember(viewerOf(ana), leo.membership.id)).toEqual({ ok: true });
    expect(await blockMember(viewerOf(ana), leo.membership.id)).toEqual({ ok: true }); // once only
    const b = await blockedFor(viewerOf(ana));
    expect([...b.memberships]).toEqual([leo.membership.id]);
    expect([...b.users]).toEqual([leo.user.id]);
    const a = await arena(ana);
    expect(a.wins.map((w) => w.id).sort()).toEqual(["w-coach", "w-mia"]);
    const seat = a.rows.find((r) => r.membershipId === leo.membership.id)!;
    expect(seat).toMatchObject({ name: A_MEMBER, photo: false, veiled: true });
    expect(a.rows).toHaveLength(4); // the seat stays, so the counts add up
    const all = seatsOf(a);
    const drawn = [...all.rings.flat(), ...all.champs].find((s) => s.membershipId === leo.membership.id)!;
    expect(drawn).toMatchObject({ name: A_MEMBER, initials: "?", photo: false });
    // Mia sees Leo as before; Leo is never told.
    const m = await arena(mia);
    expect(m.wins.map((w) => w.id)).toContain("w-leo");
    expect(m.rows.find((r) => r.membershipId === leo.membership.id)).toMatchObject({ name: "Leo Tolstoy", veiled: false });
    expect((await blockedFor(viewerOf(leo))).memberships.size).toBe(0);
  });

  it("a coach switched into the member sees the member's view without the member's blocks", async () => {
    const sw = await arena(ana, { switchedInto: { membershipId: ana.membership.id } });
    expect(sw.wins.map((w) => w.id)).toContain("w-leo");
    expect(sw.rows.find((r) => r.membershipId === leo.membership.id)?.veiled).toBe(false);
  });

  it("the Settings list names who is blocked; Unblock brings them back", async () => {
    expect((await blockedList(viewerOf(ana))).map((r) => [r.membershipId, r.name])).toEqual([[leo.membership.id, "Leo Tolstoy"]]);
    await unblockMember(viewerOf(ana), leo.membership.id);
    expect((await blockedFor(viewerOf(ana))).memberships.size).toBe(0);
    expect((await arena(ana)).wins.map((w) => w.id)).toContain("w-leo");
  });

  it("a block row that names a coach is never applied", async () => {
    await db.insert(schema.memberBlocks).values({ id: "b-bad", workspaceId: W, blockerMembershipId: ana.membership.id, blockedMembershipId: coach.membership.id });
    expect((await blockedFor(viewerOf(ana))).memberships.size).toBe(0);
    await db.delete(schema.memberBlocks);
  });
});

describe("report a win or a member (H-745)", () => {
  it("a report is validated and checked against the workspace; the coach goes to Support", async () => {
    expect(await reportContent(viewerOf(ana), { targetKind: "win", targetId: "w-mia", reason: "nope", note: "" })).toMatchObject({ ok: false });
    expect(await reportContent(viewerOf(ana), { targetKind: "win", targetId: "w-none", reason: "spam", note: "" })).toMatchObject({ ok: false });
    expect(await reportContent(viewerOf(ana), { targetKind: "member", targetId: "m-out", reason: "spam", note: "" })).toMatchObject({ ok: false });
    expect(await reportContent(viewerOf(ana), { targetKind: "win", targetId: "w-coach", reason: "harassment", note: "" })).toMatchObject({ ok: false, support: true });
    expect(await reportContent(viewerOf(ana), { targetKind: "member", targetId: coach.membership.id, reason: "other", note: "" })).toMatchObject({ ok: false, support: true });
    expect(await db.query.memberReports.findMany()).toEqual([]);
  });

  it("reporting a win lands as Content in the coach's inbox and hides the win from the reporter at once, only from them", async () => {
    expect(await reportContent(viewerOf(ana), { targetKind: "win", targetId: "w-mia", reason: "harassment", note: "  Not kind  " })).toEqual({ ok: true });
    const [r] = await db.query.memberReports.findMany();
    expect(r).toMatchObject({ workspaceId: W, userId: ana.user.id, kind: "content", severity: "red", description: "Not kind", targetKind: "win", targetId: "w-mia", targetUserId: mia.user.id, handledAt: null });
    expect((await arena(ana)).wins.map((w) => w.id)).not.toContain("w-mia");
    expect((await arena(leo)).wins.map((w) => w.id)).toContain("w-mia");
    expect(await reportContent(viewerOf(ana), { targetKind: "member", targetId: leo.membership.id, reason: "spam", note: "" })).toEqual({ ok: true });
    expect((await myReports(viewerOf(ana))).map((x) => x.targetKind).sort()).toEqual(["member", "win"]);
  });

  it("Hide this win: gone for everyone, the reporter's report handled; the undo brings it back", async () => {
    expect(await setWinHidden({ workspaceId: "ws2", userId: "u-out" }, "w-mia", true)).toBe(false); // another workspace's coach
    expect(await setWinHidden({ workspaceId: W, userId: coach.user.id }, "w-mia", true)).toBe(true);
    for (const p of [ana, leo, mia, coach]) expect((await arena(p)).wins.map((w) => w.id), p.user.name).not.toContain("w-mia");
    expect((await db.query.colosseumWins.findFirst({ where: (t, { eq }) => eq(t.id, "w-mia") }))).toMatchObject({ hiddenBy: coach.user.id });
    const handled = (await myReports(viewerOf(ana))).find((x) => x.targetKind === "win")!;
    expect(handled.handledAt).toBeTruthy();
    await setWinHidden({ workspaceId: W, userId: coach.user.id }, "w-mia", false);
    expect((await arena(leo)).wins.map((w) => w.id)).toContain("w-mia");
    expect((await myReports(viewerOf(ana))).find((x) => x.targetKind === "win")!.handledAt).toBeNull();
  });
});

describe("the word filter, where a win is saved (H-745)", () => {
  it("holds back a listed word and saves a normal win", async () => {
    expect(await shareWin({ workspaceId: W, userId: ana.user.id }, "business", "Closed a FUCKING big deal")).toEqual({ ok: false, error: WIN_REFUSED });
    expect(await shareWin({ workspaceId: W, userId: ana.user.id }, "business", "Taught a class on cocktail pricing")).toEqual({ ok: true });
    const mine = await db.query.colosseumWins.findMany({ where: (t, { eq }) => eq(t.userId, ana.user.id) });
    expect(mine.map((w) => w.text)).toEqual(["Taught a class on cocktail pricing"]);
  });
});

describe("account deletion (H-745)", () => {
  it("erases the blocks on either side and the reports by or about the deleted member", async () => {
    await blockMember(viewerOf(ana), leo.membership.id);
    await blockMember(viewerOf(leo), mia.membership.id);
    await blockMember(viewerOf(mia), ana.membership.id);
    await reportContent(viewerOf(mia), { targetKind: "member", targetId: leo.membership.id, reason: "other", note: "" });
    await reportContent(viewerOf(leo), { targetKind: "win", targetId: "w-mia", reason: "spam", note: "" });
    // No stored photo to remove in this test: the rows are what it checks.
    await db.update(schema.memberships).set({ headshotUrl: null });
    const plan = (await planErase(W, leo.membership.id))!;
    expect(plan.counts.member_blocks).toBe(2);
    expect(plan.counts.member_reports).toBe(3); // Ana's and Mia's about Leo, and Leo's own
    await eraseMember(plan, coach.user.id);
    const blocks = await db.query.memberBlocks.findMany();
    expect(blocks.map((b) => [b.blockerMembershipId, b.blockedMembershipId])).toEqual([[mia.membership.id, ana.membership.id]]);
    const reports = await db.query.memberReports.findMany();
    expect(reports.map((r) => [r.userId, r.targetUserId])).toEqual([[ana.user.id, mia.user.id]]);
  });
});
