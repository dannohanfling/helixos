import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Claude's drafts everywhere (H-184), offers first, on a real database of its own: a draft never writes into the offer, Approve
 * swaps it in with history and Undo, Discard is clean, a red line keeps Approve off, a draft of a new offer makes it only on
 * Approve, Edit settles a draft, and another member's or workspace's draft and offer read as not there. Migration 0237.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-claude-drafts-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const d = await import("@/lib/claude-drafts");

const W = "w-cd";
const MAYA = { workspaceId: W, userId: "u-maya" };
const JO = { workspaceId: W, userId: "u-jo" };
const CLAUDE = { name: "Maya Torres", connector: true };
const MAYA_HERSELF = { name: "Maya Torres", connector: false };
const offer = async (id: string) => (await db.query.offers.findFirst({ where: eq(schema.offers.id, id) }))!;
const draft = async (id: string) => (await db.query.drafts.findFirst({ where: eq(schema.drafts.id, id) }))!;

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-cd", clientInviteCode: "CI-CD", coachInviteCode: "CO-CD" });
  for (const [id, name] of [["u-maya", "Maya Torres"], ["u-jo", "Jo Lee"]] as const) {
    await db.insert(schema.users).values({ id, email: `${id}@cd.test`, name, passwordHash: "x", firstSignedInAt: "2026-10-01T00:00:00.000Z" });
    await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role: "client" });
  }
  await db.insert(schema.offers).values([
    { id: "o-maya", ...MAYA, name: "The Reset", promise: "Calmer mornings in 30 days.", price: 997 },
    { id: "o-jo", ...JO, name: "Jo's offer", promise: "Jo's words." },
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a draft beside the offer", () => {
  let first = "";
  it("never writes into the offer, and a newer draft replaces the older", async () => {
    first = await d.saveDraft(MAYA, "offer", "o-maya", { promise: "A first try." }, [], CLAUDE);
    const second = await d.saveDraft(MAYA, "offer", "o-maya", { promise: "Calmer mornings, without the 5 a.m. alarm.", whyNow: "School starts soon." }, [], CLAUDE);
    expect((await offer("o-maya")).promise).toBe("Calmer mornings in 30 days.");
    expect((await draft(first)).status).toBe("replaced");
    const waiting = await d.pendingDrafts(MAYA, "offer", "o-maya");
    expect(waiting.map((x) => x.id)).toEqual([second]);
    expect(waiting[0]!.base).toEqual({ promise: "Calmer mornings in 30 days.", whyNow: null });
    expect(waiting[0]!.byLabel).toBe("Claude (connector)");
    expect(await d.waitingByMenu(MAYA)).toEqual({ "/offers": 1 });
  });

  it("Approve swaps it in, keeps the old words for Undo, and Undo puts them back", async () => {
    const [w] = await d.pendingDrafts(MAYA, "offer", "o-maya");
    expect(await d.approveDraft(MAYA, w!.id, MAYA_HERSELF)).toEqual({ ok: true, targetId: "o-maya" });
    expect(await offer("o-maya")).toMatchObject({ promise: "Calmer mornings, without the 5 a.m. alarm.", whyNow: "School starts soon.", status: "draft" });
    expect(await d.approveDraft(MAYA, w!.id, MAYA_HERSELF)).toEqual({ ok: false, why: "That draft isn't waiting any more." });
    const h = (await d.changesFor(MAYA, "offer", "o-maya")).find((x) => x.action === "approved")!;
    expect(h.before).toEqual({ promise: "Calmer mornings in 30 days.", whyNow: null });
    expect(await d.undoChange(MAYA, h.id, MAYA_HERSELF)).toEqual({ ok: true, targetId: "o-maya" });
    expect(await offer("o-maya")).toMatchObject({ promise: "Calmer mornings in 30 days.", whyNow: null });
    expect(await d.undoChange(MAYA, h.id, MAYA_HERSELF)).toEqual({ ok: false, why: "That was already undone." });
    expect(await d.waitingByMenu(MAYA)).toEqual({});
  });

  it("Discard drops only the draft, and its Undo brings the draft back", async () => {
    const id = await d.saveDraft(MAYA, "offer", "o-maya", { guarantee: "Do the work; if it doesn't help, I'll coach you until it does." }, [], CLAUDE);
    expect(await d.discardDraft(MAYA, id, MAYA_HERSELF)).toEqual({ ok: true, targetId: "o-maya" });
    expect((await offer("o-maya")).guarantee).toBeNull();
    const h = (await d.changesFor(MAYA, "offer", "o-maya")).find((x) => x.action === "discarded" && x.draftId === id)!;
    expect(await d.undoChange(MAYA, h.id, MAYA_HERSELF)).toMatchObject({ ok: true });
    expect((await draft(id)).status).toBe("pending");
    await d.discardDraft(MAYA, id, MAYA_HERSELF);
  });
});

describe("red lines keep Approve off", () => {
  it("when the offer changed since the draft was written", async () => {
    const id = await d.saveDraft(MAYA, "offer", "o-maya", { promise: "Claude's new promise." }, [], CLAUDE);
    await db.update(schema.offers).set({ promise: "Maya changed it herself." }).where(eq(schema.offers.id, "o-maya"));
    const r = await d.approveDraft(MAYA, id, MAYA_HERSELF);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toMatch(/changed since Claude wrote this/);
    expect((await offer("o-maya")).promise).toBe("Maya changed it herself.");
    // Edit: she saved the form opened with the draft in it; the draft is settled as edited.
    await d.markDraftEdited(MAYA, id, "o-maya", MAYA_HERSELF);
    expect((await draft(id)).status).toBe("edited");
  });

  it("when the price isn't in her own facts, unless she said it", async () => {
    const id = await d.saveDraft(MAYA, "offer", "o-maya", { price: 1497 }, [], CLAUDE);
    expect(await d.redLinesFor(MAYA, await draft(id))).toEqual([expect.stringMatching(/price 1497 isn't in your own facts/)]);
    const said = await d.saveDraft(MAYA, "offer", "o-maya", { price: 1497 }, [], CLAUDE, "Put the price up to 1,497.");
    expect(await d.redLinesFor(MAYA, await draft(said))).toEqual([]);
    expect(await d.approveDraft(MAYA, said, MAYA_HERSELF)).toMatchObject({ ok: true });
    expect((await offer("o-maya")).price).toBe(1497);
  });
});

describe("a draft of a new offer", () => {
  it("makes the offer only on Approve, as a draft offer, and its Approve has no Undo", async () => {
    const before = (await db.query.offers.findMany({ where: eq(schema.offers.userId, "u-maya") })).length;
    const id = await d.saveDraft(MAYA, "offer", null, { name: "Morning Club", promise: "A calm start, together." }, [], CLAUDE);
    expect((await db.query.offers.findMany({ where: eq(schema.offers.userId, "u-maya") })).length).toBe(before);
    const r = await d.approveDraft(MAYA, id, MAYA_HERSELF);
    expect(r.ok && r.targetId).toBeTruthy();
    const made = await offer((r as { targetId: string }).targetId);
    expect(made).toMatchObject({ name: "Morning Club", promise: "A calm start, together.", status: "draft", workspaceId: W, userId: "u-maya" });
    const h = (await d.changesFor(MAYA, "offer", made.id)).find((x) => x.action === "approved")!;
    expect(d.canUndo(h, Date.now())).toBe(false);
  });

  it("Edit makes the offer with its name and moves the draft onto it", async () => {
    const id = await d.saveDraft(MAYA, "offer", null, { name: "Evening Club", whyNow: "Winter." }, [], CLAUDE);
    const r = await d.startFromNewDraft(MAYA, id);
    expect(r.ok).toBe(true);
    const target = (r as { targetId: string }).targetId;
    expect(await offer(target)).toMatchObject({ name: "Evening Club", whyNow: null });
    expect(await draft(id)).toMatchObject({ targetId: target, status: "pending", base: { name: "Evening Club", whyNow: null } });
  });
});

describe("each member's own", () => {
  it("another member's draft and offer read as not there", async () => {
    const id = await d.saveDraft(JO, "offer", "o-jo", { promise: "Jo's draft." }, [], CLAUDE);
    expect(await d.approveDraft(MAYA, id, MAYA_HERSELF)).toEqual({ ok: false, why: "That draft isn't waiting any more." });
    expect(await d.discardDraft({ workspaceId: "w-other", userId: "u-jo" }, id, MAYA_HERSELF)).toMatchObject({ ok: false });
    expect(await d.areaRow(MAYA, "offer", "o-jo")).toBeNull();
    // A draft against someone else's offer has nothing to approve into.
    const stray = await d.saveDraft(MAYA, "offer", "o-jo", { promise: "Not hers." }, [], CLAUDE);
    expect(await d.approveDraft(MAYA, stray, MAYA_HERSELF)).toMatchObject({ ok: false });
    expect((await offer("o-jo")).promise).toBe("Jo's words.");
  });
});

describe("migration 0237", () => {
  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0237_drafts");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0237").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
