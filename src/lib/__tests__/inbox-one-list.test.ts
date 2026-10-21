import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * One list for the owner (H-1488, H-1494), on a real database of its own: the Inbox number equals the rows the Inbox lists as
 * waiting on them (undecided approvals and open "needs you" items) plus the unread messages under New for you; a decided,
 * held or superseded post counts nowhere; an item settles when its H-number is decided, when a "Merged PR #N" post names its
 * PR, or when the owner ticks it; an old one reaches its agent's check-in as "still needed?".
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-inbox-one-list-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail: vi.fn(async () => "logged" as const) }));

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
const { checkinFor, decideHandoff, holdHandoff, inboxCount, inboxCounts, markOwnerRead, openNeeds, ownerInbox, postHandoff, tickNeed } = await import("@/lib/handoff");
const { reportToForum } = await import("@/lib/forum");

const W = "w-one-list";
const U = "u-danno";
const o = { workspaceId: W, userId: U };
let viator: typeof schema.forumAgents.$inferSelect;
let hermes: typeof schema.forumAgents.$inferSelect;

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-one-list", clientInviteCode: "CI-ONE", coachInviteCode: "CO-ONE" });
  await db.insert(schema.users).values({ id: U, email: "danno@one-list.test", name: "Danno Hanfling", passwordHash: "x" });
  await db.insert(schema.memberships).values({ id: `m-${U}`, workspaceId: W, userId: U, role: "coach" });
  await db.insert(schema.forumAgents).values([
    { id: "a-viator", workspaceId: W, userId: U, name: "Viator", nameKey: "viator" },
    { id: "a-hermes", workspaceId: W, userId: U, name: "Hermes", nameKey: "hermes" },
  ]);
  viator = (await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, "a-viator") }))!;
  hermes = (await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, "a-hermes") }))!;
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const post = (from: typeof viator, raw: Record<string, unknown>) => postHandoff(o, from, { to: "danno", kind: "status", title: "t", body: "b", ...raw });

describe("the Inbox number is the list (H-1488, H-1494)", () => {
  it("counts exactly what the Inbox shows: approvals waiting, open needs, unread messages; never a decided, held or superseded post", async () => {
    const undecided = await post(viator, { kind: "plan", title: "Plan: the push stack", body: "Merge order for the push stack.", needs_approval: true });
    const decided = await post(viator, { kind: "plan", title: "Plan: evening digest", body: "Said and done.", needs_approval: true });
    expect((await decideHandoff(o, U, decided.id, "approved", "")).ok).toBe(true);
    await post(hermes, { kind: "status", title: "FYI: Host pages are on", body: "Nothing to decide." });
    const old = await post(hermes, { kind: "plan", title: "Plan: stalled session v1", body: "First take.", needs_approval: true });
    await post(hermes, { kind: "plan", title: "Plan: stalled session v2", body: "Second take.", needs_approval: true, superseded_by: `H-${old.seq}` });
    const held = await post(viator, { kind: "plan", title: "Plan: webinar page", body: "On hold.", needs_approval: true });
    await holdHandoff(o, viator.id, `H-${held.seq}`, "waiting on the zip");
    // Three "needs you" items: one plain, one naming the decided plan, one naming a PR that a Merged post reports.
    for (const [agent, what] of [
      [viator, "Pick the merge order for the push stack"],
      [viator, `Approve H-${decided.seq} (evening digest)`],
      [hermes, "Allow the PR #99 rebase"],
    ] as const) expect((await reportToForum(o, { agent: agent.name, needs_you: { what } }, "agent")).ok).toBe(true);
    await post(hermes, { kind: "status", title: "Merged PR #99: the rebase", body: "On main." });
    // H-1554: a merge reported under another title, a Ready the member decided, and an ask naming a superseded post all settle too.
    const readyDone = await post(viator, { kind: "status", title: "Ready to merge PR #77: the digest", body: "Gated.", needs_approval: true });
    expect((await decideHandoff(o, U, readyDone.id, "approved", "")).ok).toBe(true);
    await post(hermes, { kind: "status", title: "#88 is on main (merged this morning)", body: "Live." });
    for (const what of ["Tap Approve on the #77 Ready", "Allow the #88 rebase", `Approve H-${old.seq} (stalled session v1)`]) expect((await reportToForum(o, { agent: hermes.name, needs_you: { what } }, "agent")).ok).toBe(true);
    const list = await ownerInbox(o);
    // Waiting: the undecided plan and the v2 plan (its v1 is superseded, the held one waits on its hold). Needs: the plain one.
    expect(list.waiting.map((m) => m.title).sort()).toEqual(["Plan: stalled session v2", "Plan: the push stack"]);
    expect(list.needs.map((n) => n.what)).toEqual(["Pick the merge order for the push stack"]);
    // New for you: the FYI and the Merged post, to Danno without an approval; the decision's own answer went to the agent.
    expect(list.fresh.map((m) => m.title).sort()).toEqual(["#88 is on main (merged this morning)", "FYI: Host pages are on", "Merged PR #99: the rebase"]);
    const counts = await inboxCounts(o);
    expect(counts).toEqual({ waiting: 2, needs: 1, fresh: 3 });
    expect(await inboxCount(o)).toBe(list.waiting.length + list.needs.length + list.fresh.length);
    // Opening the page reads the messages: the number drops to what still waits, and the list keeps them for a while.
    await markOwnerRead(o);
    expect(await inboxCount(o)).toBe(3);
    expect((await ownerInbox(o)).fresh.length).toBe(3);
    // Done on the Inbox, then the decision on the push stack: nothing waits.
    expect(await tickNeed(o, list.needs[0]!.id)).toBe(true);
    expect(await tickNeed(o, list.needs[0]!.id)).toBe(false);
    expect((await decideHandoff(o, U, undecided.id, "declined", "")).ok).toBe(true);
    expect((await ownerInbox(o)).waiting.map((m) => m.title)).toEqual(["Plan: stalled session v2"]);
    expect(await inboxCount(o)).toBe(1);
  });
  it("a decision settles the items naming that H-number, and the agent's check-in asks about one open for days", async () => {
    const plan = await post(viator, { kind: "plan", title: "Plan: Partner C", body: "The importer.", needs_approval: true });
    expect((await reportToForum(o, { agent: "Viator", needs_you: { what: `Tap H-${plan.seq} when you can` } }, "agent")).ok).toBe(true);
    expect((await openNeeds(o)).map((n) => n.ref)).toEqual([`H-${plan.seq}`]);
    expect((await decideHandoff(o, U, plan.id, "approved", "")).ok).toBe(true);
    expect(await openNeeds(o)).toEqual([]);
    expect((await reportToForum(o, { agent: "Viator", needs_you: { what: "Choose the Alchemist take" } }, "agent")).ok).toBe(true);
    const fresh = await checkinFor(o, viator);
    expect(fresh.stale).toEqual([]);
    const four = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const later = await checkinFor(o, viator, four);
    expect(later.stale).toEqual(["Choose the Alchemist take"]);
    expect((await checkinFor(o, hermes, four)).stale).toEqual([]);
  });
});
