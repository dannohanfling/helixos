import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Claude's drafts of the Essence, lead magnets and posts (H-184 D2b), on a real database of its own: Approve writes one Essence
 * section and leaves the rest, refuses past the Essence's cap, makes a new magnet unpublished with its own keyword and address,
 * lands a post In progress on its date with its pillar and never schedules it, refuses a post already scheduled, and each
 * member reaches only their own.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-claude-drafts-areas-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const d = await import("@/lib/claude-drafts");

const W = "w-cda";
const MAYA = { workspaceId: W, userId: "u-maya" };
const JO = { workspaceId: W, userId: "u-jo" };
const CLAUDE = { name: "Maya Torres", connector: true };
const HER = { name: "Maya Torres", connector: false };

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-cda", clientInviteCode: "CI-CDA", coachInviteCode: "CO-CDA" });
  for (const [id, name] of [["u-maya", "Maya Torres"], ["u-jo", "Jo Lee"]] as const) {
    await db.insert(schema.users).values({ id, email: `${id}@cda.test`, name, passwordHash: "x", firstSignedInAt: "2026-10-01T00:00:00.000Z" });
    await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role: "client" });
  }
  await db.insert(schema.essences).values({ id: "e-maya", ...MAYA, data: { identity: { name: "Maya" }, mission_and_vision: { mission_statement: "Old mission.", vision_statement: "Old vision." } } });
  await db.insert(schema.leadMagnets).values({ id: "lm-maya", ...MAYA, title: "Morning checklist", keyword: "MORNING", slug: "morning-checklist" });
  await db.insert(schema.contentItems).values([
    { id: "c-idea", ...MAYA, title: "An idea", status: "idea" },
    { id: "c-sched", ...MAYA, title: "Going out", status: "scheduled", postAt: "2026-11-01T09:00:00" },
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Essence", () => {
  it("Approve writes the one section's drafted fields and leaves the rest; Undo puts them back", async () => {
    const id = await d.saveDraft(MAYA, "essence", "mission_and_vision", { mission_statement: "Help coaches sell with calm." }, [], CLAUDE);
    expect(await d.approveDraft(MAYA, id, HER)).toEqual({ ok: true, targetId: "mission_and_vision" });
    const row = (await db.query.essences.findFirst({ where: eq(schema.essences.id, "e-maya") }))!;
    expect(row.data.mission_and_vision).toEqual({ mission_statement: "Help coaches sell with calm.", vision_statement: "Old vision." });
    expect(row.data.identity).toMatchObject({ name: "Maya" });
    const h = (await d.changesFor(MAYA, "essence", "mission_and_vision")).find((x) => x.action === "approved")!;
    expect(await d.undoChange(MAYA, h.id, HER)).toMatchObject({ ok: true });
    expect((await db.query.essences.findFirst({ where: eq(schema.essences.id, "e-maya") }))!.data.mission_and_vision).toMatchObject({ mission_statement: "Old mission." });
  });

  it("refuses an Approve that would take the Essence past its limit", async () => {
    const id = await d.saveDraft(MAYA, "essence", "brand_and_differentiation", { unique_value_proposition: "x".repeat(2900), signature_style: "y".repeat(2900) }, [], CLAUDE);
    for (const s of ["knowledge_and_expertise", "communication_guidelines", "emotional_intelligence", "ethical_standards", "key_outcomes_for_users", "cultural_and_philosophical_alignment"]) {
      const fill = await d.saveDraft(MAYA, "essence", s, Object.fromEntries((await import("@/lib/engine/essence")).sectionByKey(s)!.fields.filter((f) => f.kind === "text").map((f) => [f.key, "z".repeat(2900)])), [], CLAUDE);
      await d.approveDraft(MAYA, fill, HER);
    }
    const r = await d.approveDraft(MAYA, id, HER);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toMatch(/over its limit/);
  });
});

describe("lead magnets", () => {
  it("a new magnet is made only on Approve, unpublished, with its own keyword and address, its words marked accepted", async () => {
    const id = await d.saveDraft(MAYA, "magnet", null, { title: "Morning reset guide", promise: "A calmer start.", content: { intro: "Start here.", sections: [{ heading: "Night before", items: ["Lay out clothes"] }], closing: "Book a call." } }, [], CLAUDE);
    const r = await d.approveDraft(MAYA, id, HER);
    const m = (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, (r as { targetId: string }).targetId) }))!;
    expect(m).toMatchObject({ title: "Morning reset guide", publishedAt: null, origin: "ai_accepted", workspaceId: W, userId: "u-maya" });
    expect(m.keyword).toBe("MORNING2");
    expect(m.slug).toBe("morning-reset-guide");
    expect(m.content.sections[0]!.heading).toBe("Night before");
  });
  it("an edit leaves the keyword, address and publishing alone", async () => {
    const id = await d.saveDraft(MAYA, "magnet", "lm-maya", { promise: "Mornings that start calm." }, [], CLAUDE);
    await d.approveDraft(MAYA, id, HER);
    expect(await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, "lm-maya") })).toMatchObject({ promise: "Mornings that start calm.", keyword: "MORNING", slug: "morning-checklist", publishedAt: null });
  });
});

describe("posts", () => {
  it("lands In progress on its date with its pillar, never scheduled", async () => {
    const id = await d.saveDraft(MAYA, "content", "c-idea", { hook: "Your mornings aren't broken.", suggestedDate: "2026-11-03", pillar: "Calm" }, [], CLAUDE);
    await d.approveDraft(MAYA, id, HER);
    expect(await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, "c-idea") })).toMatchObject({ hook: "Your mornings aren't broken.", status: "creating", postAt: "2026-11-03T09:00:00", notes: "Pillar: Calm", origin: "ai_accepted" });
    const row = await d.areaRow(MAYA, "content", "c-idea");
    expect(row).toMatchObject({ pillar: "Calm", suggestedDate: "2026-11-03" });
  });
  it("a new post is made only on Approve, and never scheduled", async () => {
    const id = await d.saveDraft(MAYA, "content", null, { title: "A new one", body: "Words." }, [], CLAUDE);
    const r = await d.approveDraft(MAYA, id, HER);
    expect(await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, (r as { targetId: string }).targetId) })).toMatchObject({ title: "A new one", body: "Words.", status: "creating", postAt: null });
  });
  it("keeps Approve off on a post already scheduled", async () => {
    const id = await d.saveDraft(MAYA, "content", "c-sched", { hook: "Changed" }, [], CLAUDE);
    const r = await d.approveDraft(MAYA, id, HER);
    expect(!r.ok && r.why).toMatch(/already scheduled/);
    expect((await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, "c-sched") }))!.hook).toBeNull();
  });
});

describe("each member's own", () => {
  it("another member's Essence, magnet and post read as not there", async () => {
    expect(await d.areaRow(JO, "magnet", "lm-maya")).toBeNull();
    expect(await d.areaRow(JO, "content", "c-idea")).toBeNull();
    expect(await d.areaRow(JO, "essence", "mission_and_vision")).toEqual({});
    const stray = await d.saveDraft(JO, "magnet", "lm-maya", { promise: "Not hers." }, [], CLAUDE);
    expect(await d.approveDraft(JO, stray, HER)).toMatchObject({ ok: false });
  });
});
