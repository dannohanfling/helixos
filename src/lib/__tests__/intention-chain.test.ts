import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The intention chain (H-195 #14, H-198), on a real database of its own: a week links to the member's own initiative and key
 * results only (another member's record is never linked), the link survives an edit, a tick in Tasks shows in the chain, the
 * Friday number is logged on the key result's typed KPI dated that day and never on a Numbers one, a deleted task leaves the
 * intention or keeps its words as chosen, and the initiative lists the weeks under it. And migration 0217's order.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-chain-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

const { db, schema, ensureMigrated } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const { viewerFor } = await import("@/lib/auth");
const { saveWeekIntention } = await import("@/lib/intentions-core");
const { chainFor, linkWeek, logWeekActuals, unhookIntentionTask, weeksUnder } = await import("@/lib/intention-chain");
const { toggleTask, ownTask } = await import("@/lib/tasks-core");

const W = "w-chain";
const M = { workspaceId: W, userId: "u-maya" };
const OTHER = { workspaceId: W, userId: "u-other" };
const week = async () => (await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, W), eq(schema.weeklyIntentions.userId, M.userId)) }))!;

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-chain", clientInviteCode: "CI-CHAIN", coachInviteCode: "CO-CHAIN", timezone: "America/Los_Angeles" });
  for (const u of [M.userId, OTHER.userId]) {
    await db.insert(schema.users).values({ id: u, email: `${u}@chain.test`, name: u, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: `m-${u}`, workspaceId: W, userId: u, role: "client" });
  }
  await db.insert(schema.planRecords).values([
    { id: "init-1", ...M, kind: "initiative", title: "Launch the webinar" },
    { id: "kr-1", ...M, kind: "key_result", title: "10 booked calls this month" },
    { id: "kr-other", ...OTHER, kind: "key_result", title: "Someone else's" },
  ]);
  await db.insert(schema.kpis).values([
    { id: "kpi-manual", ...M, recordId: "kr-1", name: "Calls booked", source: "manual", target: 10 },
    { id: "kpi-numbers", ...M, recordId: "kr-1", name: "Calls from the log", source: "numbers", metric: "callsBooked", target: 10 },
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the intention chain", () => {
  it("links only the member's own records, and the link survives an edit", async () => {
    const v = (await viewerFor(M.userId, W))!;
    await saveWeekIntention({ ...M, today: v.today }, { word: "Focus", keyResults: ["Book 3 calls", "Post 5 times"], initiative: "Slides", tasks: ["Write the hook", "Book the room"] });
    const w = await week();
    expect(await linkWeek(M, w.id, "init-1", ["kr-1", "kr-other"])).toBe(true);
    let after = await week();
    expect(after.initiativeId).toBe("init-1");
    expect(after.keyResults.map((k) => k.krId ?? null)).toEqual(["kr-1", null]);
    await saveWeekIntention({ ...M, today: v.today }, { word: "Focus", keyResults: ["Book 3 calls", "Post 6 times"], initiative: "Slides", tasks: ["Write the hook", "Book the room"] });
    after = await week();
    expect(after.initiativeId).toBe("init-1");
    expect(after.keyResults[0]!.krId).toBe("kr-1");
    // Another member can't link Maya's week at all.
    expect(await linkWeek(OTHER, w.id, null, [])).toBe(false);
  });

  it("a tick in Tasks shows in the chain, from initiative down", async () => {
    const v = (await viewerFor(M.userId, W))!;
    const w = await week();
    const t = (await ownTask(v, w.tasks[0]!.taskId!))!;
    await toggleTask(v, t);
    const chain = await chainFor(M, v.today);
    expect(chain.initiative?.title).toBe("Launch the webinar");
    expect(chain.week?.word).toBe("Focus");
    expect(chain.tasks).toEqual({ done: 1, total: 2 });
    expect(chain.keyResults[0]!.kr?.id).toBe("kr-1");
  });

  it("logs the Friday number on the typed KPI, dated that day, never on a Numbers one", async () => {
    const w = await week();
    const keyResults = w.keyResults.map((k, i) => (i === 0 ? { ...k, actual: 2 } : k));
    expect(await logWeekActuals(M, { keyResults }, "2026-10-23")).toBe(1);
    const values = await db.query.kpiValues.findMany({ where: eq(schema.kpiValues.userId, M.userId) });
    expect(values.map((x) => [x.kpiId, x.date, x.value])).toEqual([["kpi-manual", "2026-10-23", 2]]);
  });

  it("a deleted task keeps its words on the intention, or leaves it, as chosen", async () => {
    let w = await week();
    const [first, second] = w.tasks;
    expect(await unhookIntentionTask(M, first!.taskId!, false)).toBe(true);
    w = await week();
    expect(w.tasks[0]).toEqual({ title: first!.title, taskId: null });
    expect(await unhookIntentionTask(M, second!.taskId!, true)).toBe(true);
    w = await week();
    expect(w.tasks.map((t) => t.title)).toEqual([first!.title]);
  });

  it("the initiative lists the weeks under it", async () => {
    const weeks = await weeksUnder(M, "init-1");
    expect(weeks.map((x) => x.word)).toEqual(["Focus"]);
    expect(await weeksUnder(OTHER, "init-1")).toEqual([]);
  });
});

describe("migration 0217", () => {
  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0217_intention_chain");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0217").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
