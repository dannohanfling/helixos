import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Merging reports and agents' Done drafts (H-202, second half), on a real database of its own: only one member's reports merge,
 * the merged ones follow the top one's status, one reply answers them all and goes to the member once, a follow-up on a merged
 * one goes to the top, a Done draft waits for Send unless the workspace sends them on its own, and is never sent twice. 0233.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-merge-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
const sendEmail = vi.fn(async () => "logged" as const);
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail }));

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { followUp, mergeReports, myReports, saveDoneDraft, sendReply, unmergeReport, withMessages } = await import("@/lib/report-replies");
const { unseenReports } = await import("@/lib/queries/reports");
const { HOW_BLANK } = await import("@/lib/engine/report-status");

const W = "w-merge";
const COACH = { workspaceId: W, userId: "u-coach", name: "Danno Hanfling" };
const MAYA = { workspaceId: W, userId: "u-maya" };
const report = async (id: string) => (await db.query.memberReports.findFirst({ where: eq(schema.memberReports.id, id) }))!;
const statusMessages = async (id: string) => (await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.reportId, id) })).filter((m) => m.kind === "status");
const DONE = "Done: the GoHighLevel connection is fixed. It now reconnects on its own. Thanks for flagging it!";

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-merge", clientInviteCode: "CI-MRG", coachInviteCode: "CO-MRG" });
  for (const [id, name, role] of [["u-coach", "Danno Hanfling", "coach"], ["u-maya", "Maya Torres", "client"], ["u-jo", "Jo Lee", "client"]] as const) {
    await db.insert(schema.users).values({ id, email: `${id}@merge.test`, name, passwordHash: "x", firstSignedInAt: "2026-10-01T00:00:00.000Z" });
    await db.insert(schema.memberships).values({ id: `m-${id}`, workspaceId: W, userId: id, role, emailsEnabled: true });
  }
  await db.insert(schema.memberReports).values([
    { id: "r-1", ...MAYA, kind: "issue", severity: "red", description: "GoHighLevel still not connecting.", createdAt: "2026-10-08 10:00:00" },
    { id: "r-2", ...MAYA, kind: "issue", severity: "orange", description: "Still not connecting, second try.", createdAt: "2026-10-11 10:00:00" },
    { id: "r-3", ...MAYA, kind: "issue", severity: "orange", description: "GHL again.", createdAt: "2026-10-12 10:00:00" },
    { id: "r-jo", workspaceId: W, userId: "u-jo", kind: "suggestion", severity: "green", description: "A calendar link." },
  ]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("merging one member's reports", () => {
  it("refuses another member's report, an empty pick, and merging one into itself", async () => {
    expect(await mergeReports(W, "r-1", ["r-jo"])).toEqual({ ok: false, error: "Only reports from the same member can be merged." });
    expect(await mergeReports(W, "r-1", ["r-1"])).toEqual({ ok: false, error: expect.stringMatching(/Tick at least one/) });
    expect(await mergeReports(W, "r-1", ["nope"])).toEqual({ ok: false, error: expect.stringMatching(/isn't here/) });
    expect(await mergeReports("w-other", "r-1", ["r-2"])).toEqual({ ok: false, error: "That report isn't here any more." });
    expect((await report("r-jo")).parentId).toBeNull();
  });

  it("puts them under the first, counts them once, and lists them under it", async () => {
    expect(await unseenReports(W)).toBe(4);
    await db.update(schema.memberReports).set({ parentId: "r-2" }).where(eq(schema.memberReports.id, "r-3"));
    // r-3 sat under r-2: it moves up with it.
    expect(await mergeReports(W, "r-1", ["r-2"])).toEqual({ ok: true, merged: 1 });
    expect((await report("r-2")).parentId).toBe("r-1");
    expect((await report("r-3")).parentId).toBe("r-1");
    expect(await unseenReports(W)).toBe(2);
    const mine = await myReports(MAYA);
    expect(mine.map((t) => t.report.id)).toEqual(["r-1"]);
    expect(mine[0]!.merged.map((r) => r.id)).toEqual(["r-2", "r-3"]);
    expect((await withMessages(W, [await report("r-jo")]))[0]!.merged).toEqual([]);
  });

  it("one reply answers them all: their statuses follow, and the member hears it once", async () => {
    expect(await sendReply(COACH, "r-2", "working", "Quick update: we're fixing the GoHighLevel connection now.", null)).toEqual({ ok: true, emailed: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await statusMessages("r-1")).length).toBe(1);
    expect((await statusMessages("r-2")).length).toBe(0);
    for (const id of ["r-1", "r-2", "r-3"]) expect((await report(id)).status).toBe("working");
    expect((await report("r-3")).seenAt).toBeTruthy();
  });

  it("a follow-up on a merged one goes to the top, and all of them are New again", async () => {
    expect(await followUp(MAYA, "r-3", "Still broken on my phone.")).toEqual({ ok: true });
    const msgs = await db.query.reportMessages.findMany({ where: eq(schema.reportMessages.reportId, "r-1") });
    expect(msgs.filter((m) => m.kind === "followup").map((m) => m.body)).toEqual(["Still broken on my phone."]);
    for (const id of ["r-1", "r-2", "r-3"]) expect((await report(id)).status).toBe("new");
  });
});

describe("agents' Done drafts", () => {
  it("waits as a draft on the top report until the coach sends it", async () => {
    sendEmail.mockClear();
    expect(await saveDoneDraft(COACH, "r-2", `Done: fixed. ${HOW_BLANK}.`, "Hermes")).toEqual({ ok: false, error: expect.stringMatching(/how it was fixed/) });
    expect(await saveDoneDraft(COACH, "r-2", DONE, "Hermes")).toEqual({ ok: true, sent: false, reportId: "r-1" });
    const r = await report("r-1");
    expect(r).toMatchObject({ doneDraft: DONE, doneDraftBy: "Hermes", status: "new" });
    expect(sendEmail).not.toHaveBeenCalled();
    // The coach's Send clears the draft; the merged ones are Done with it.
    expect(await sendReply(COACH, "r-1", "done", DONE, null)).toEqual({ ok: true, emailed: true });
    expect((await report("r-1")).doneDraft).toBeNull();
    for (const id of ["r-1", "r-2", "r-3"]) expect((await report(id)).status).toBe("done");
    expect((await statusMessages("r-1")).at(-1)!.draftedBy).toBeNull();
  });

  it("with the switch on, goes at once from the coach's account, logged as drafted by the agent; never twice on its own", async () => {
    await db.update(schema.workspaces).set({ autoDoneAfterMerge: true }).where(eq(schema.workspaces.id, W));
    sendEmail.mockClear();
    expect(await saveDoneDraft(COACH, "r-jo", "Done: the calendar link is live. It's under Settings. Thanks for the idea!", "Medicus")).toEqual({ ok: true, sent: true, emailed: true, reportId: "r-jo" });
    const [m] = await statusMessages("r-jo");
    expect(m).toMatchObject({ status: "done", byUserId: "u-coach", draftedBy: "Medicus", emailed: true });
    expect((await report("r-jo")).status).toBe("done");
    // Already Done: a second draft waits for Send instead of going again.
    expect(await saveDoneDraft(COACH, "r-jo", "Done: the calendar link is live. Now on Today too. Thanks!", "Medicus")).toEqual({ ok: true, sent: false, reportId: "r-jo" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a draft on a merged report moves to the top when it's merged", async () => {
    await db.update(schema.workspaces).set({ autoDoneAfterMerge: false }).where(eq(schema.workspaces.id, W));
    expect(await unmergeReport(W, "r-3")).toBe(true);
    expect(await unmergeReport(W, "r-3")).toBe(false);
    expect((await report("r-3")).parentId).toBeNull();
    await saveDoneDraft(COACH, "r-3", DONE, "Hermes");
    expect(await mergeReports(W, "r-1", ["r-3"])).toEqual({ ok: true, merged: 1 });
    expect((await report("r-1")).doneDraft).toBe(DONE);
    expect((await report("r-3")).doneDraft).toBeNull();
  });
});

describe("migration 0233", () => {
  it("comes after every migration before it in the journal, by number and by time", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    const at = journal.entries.findIndex((e) => e.tag === "0233_report_merge_drafts");
    expect(at).toBeGreaterThan(0);
    for (const e of journal.entries.slice(0, at)) {
      expect(e.tag < "0233").toBe(true);
      expect(e.when).toBeLessThan(journal.entries[at]!.when);
    }
  });
});
