import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Docket PR 2, the quick wins (H-195, plan H-216), on a real database of its own: a Personal task is done with no points and
 * no ledger row while a business task still scores; "Did something else" is a task done today; a tier set on an offer counts
 * on My Helix, beside the price-read ladder; a hand tick keeps its one line; outreach messages from the close count as DMs
 * started on the Aqueduct. And migration 0216 comes after everything before it.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-docket-qw-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const { db, schema, ensureMigrated } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const { viewerFor } = await import("@/lib/auth");
const { addTask, toggleTask } = await import("@/lib/tasks-core");
const { factsFor, tickRung, rungDefs } = await import("@/lib/my-helix");
const { helixRungs } = await import("@/lib/engine/my-helix");
const { countsFor } = await import("@/lib/aqueduct");

const W = "w-dqw";
const U = "u-dqw";
const M = { workspaceId: W, userId: U };
const ledger = async () => db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.workspaceId, W), eq(schema.pointsLedger.userId, U)) });

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-dqw", clientInviteCode: "CI-DQW", coachInviteCode: "CO-DQW", timezone: "America/Los_Angeles" });
  await db.insert(schema.users).values({ id: U, email: "dqw@docket.test", name: "Member", passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: "m-dqw", workspaceId: W, userId: U, role: "client" });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a Personal task (docket #8)", () => {
  it("is done with no points and no ledger row; a business task still scores", async () => {
    const v = (await viewerFor(U, W))!;
    const personal = (await addTask(v, { title: "Walk the dog", category: "personal" }))!.task;
    expect(personal.category).toBe("personal");
    expect(personal.points).toBe(0);
    const done = await toggleTask(v, personal);
    expect(done).toMatchObject({ done: true, points: 0, awarded: false });
    expect(await ledger()).toHaveLength(0);
    const sales = (await addTask(v, { title: "Call three leads", category: "sales" }))!.task;
    const scored = await toggleTask(v, sales);
    expect(scored.points).toBeGreaterThan(0);
    expect((await ledger()).map((r) => r.type)).toEqual(["task"]);
  });
});

describe("Did something else? Add it (docket #9)", () => {
  it("is a task done today, with the usual points", async () => {
    const v = (await viewerFor(U, W))!;
    const made = (await addTask(v, { title: "Recorded a testimonial", urgency: "medium", dueDate: v.today }))!;
    await toggleTask(v, made.task);
    const row = (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, made.task.id) }))!;
    expect(row.status).toBe("done");
    expect(row.dueDate).toBe(v.today);
  });
});

describe("the offer's tier (docket #10)", () => {
  it("a tier set on an offer counts beside the tiers read from prices", async () => {
    await db.insert(schema.offers).values([
      { id: "o-free", ...M, name: "Free guide", status: "live", price: 0 },
      { id: "o-prem", ...M, name: "Mastermind", status: "live", price: 0, ladderTier: "premium" },
    ]);
    const tiers = (await factsFor(M)).offers.tiers;
    expect(tiers).toContain("freebie");
    expect(tiers).toContain("premium");
    expect(tiers).not.toContain("starter");
  });
});

describe("a hand tick keeps its one line (docket #10)", () => {
  it("is shown on the rung, with the journey rung's note", async () => {
    await tickRung(M, "p1-offer-shared", true, U, "  Posted it in the group on Tuesday  ");
    const rungs = helixRungs(await rungDefs(), await factsFor(M));
    const shared = rungs.find((r) => r.key === "p1-offer-shared")!;
    expect(shared).toMatchObject({ done: true, ticked: true, reason: "Posted it in the group on Tuesday" });
    const journey = rungs.find((r) => r.key === "p2-journey")!;
    expect(journey.note).toMatch(/Pathway/);
    expect(journey.href).toBe("/pathway");
    // The four diagnostics wait for Danno's own words: no made-up note.
    expect(rungs.find((r) => r.key === "p2-diagnostics")!.note).toBeNull();
  });
});

describe("outreach in the close (docket #9)", () => {
  it("counts as DMs started on the Aqueduct", async () => {
    await db.insert(schema.dailyLogs).values({ id: "dl-1", ...M, date: "2026-10-12", dmsStarted: 3, outreachMessages: 4, scriptsWritten: 2, videosRecorded: 1, videosPosted: 1 });
    const counts = await countsFor(M, "2026-10-12", "2026-10-12");
    expect(counts[2]).toBe(7);
  });
});

describe("migration 0216", () => {
  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0216_docket_quick_wins");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0216").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
