import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every member's own Handoff inbox (H-727, PR 1), on a real database of its own (a temporary file, migrated): the tools act
 * only on the connection's own member, another owner's H-number and file read as not there, only the owner's own decision
 * lands, the owner is named by first name, a shared inbox is the coach's to read only while the member shares, and the menu
 * item waits for an agent. Nothing is emailed.
 */
const dir = mkdtempSync(path.join(tmpdir(), "hx-member-inbox-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
const sendEmail = vi.fn(async () => "logged" as const);
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail }));

const { db, schema, ensureMigrated } = await import("@/db");
const { eq } = await import("drizzle-orm");
await import("@/lib/mcp/tools/handoff");
const { allTools, gateFor } = await import("@/lib/mcp/registry");
const { inboxGate } = await import("@/lib/mcp/tools/handoff");
const { agentsOnFor, decideHandoff, inboxCount, ownerInbox, ownerOf } = await import("@/lib/handoff");
const { canReadForum } = await import("@/lib/forum");
type Viewer = import("@/lib/auth").Viewer;

const W = "w-inbox";
const ids = { coach: "u-coach", maya: "u-maya", jordan: "u-jordan" };
const agents = { main: "a-main", scout: "a-scout", echo: "a-echo", booking: "a-booking" };
const views: Record<keyof typeof ids, Viewer> = {} as never;
const owner = (who: keyof typeof ids) => ({ workspaceId: W, userId: ids[who] });

const tool = (name: string) => allTools().find((t) => t.name === name)!;
const call = (name: string, who: keyof typeof ids, agentId: string | null, input: Record<string, unknown> = {}) => tool(name).handler(views[who], input, { scopes: ["inbox", "forum"], agentId });
const fails = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected a refusal");
};

beforeAll(async () => {
  await ensureMigrated();
  await db.insert(schema.workspaces).values({ id: W, name: "Studio", slug: "studio-inbox", clientInviteCode: "CI-INBOX", coachInviteCode: "CO-INBOX" });
  const people = [
    { id: ids.coach, email: "coach@inbox.test", name: "Danno Hanfling", role: "coach" as const },
    { id: ids.maya, email: "maya@inbox.test", name: "Maya Rivera", role: "client" as const },
    { id: ids.jordan, email: "jordan@inbox.test", name: "Jordan Lee", role: "client" as const },
  ];
  for (const p of people) {
    await db.insert(schema.users).values({ id: p.id, email: p.email, name: p.name, passwordHash: "x" });
    await db.insert(schema.memberships).values({ id: `m-${p.id}`, workspaceId: W, userId: p.id, role: p.role });
  }
  await db.insert(schema.forumAgents).values([
    { id: agents.main, workspaceId: W, userId: ids.coach, name: "Main", nameKey: "main" },
    { id: agents.scout, workspaceId: W, userId: ids.maya, name: "Scout", nameKey: "scout" },
    { id: agents.echo, workspaceId: W, userId: ids.jordan, name: "Echo", nameKey: "echo" },
    { id: agents.booking, workspaceId: W, userId: ids.jordan, name: "Booking bot", nameKey: "booking bot", builtIn: "booking" },
  ]);
  const workspace = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, W) }))!;
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const user = (await db.query.users.findFirst({ where: eq(schema.users.id, ids[key]) }))!;
    const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, ids[key]) }))!;
    views[key] = { user, workspace, membership, role: membership.role, tz: "America/Los_Angeles", today: "2026-10-18", hour: 9, actor: user, switchedInto: null, team: null };
  }
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the inbox gate (H-727): any member in their own HelixOS", () => {
  it("lets a member and the coach in, and never a switched-in coach or a team member", async () => {
    const gate = gateFor("inbox")!;
    expect(await gate(views.maya)).toBe(true);
    expect(await gate(views.coach)).toBe(true);
    expect(inboxGate({ switchedInto: { membershipId: "m", mode: "work", clientName: "Maya Rivera", coachName: "Danno Hanfling", canWork: true }, team: null })).toBe(false);
    expect(inboxGate({ switchedInto: null, team: { teamMemberId: "t", ownerMembershipId: "m", ownerName: "Maya Rivera", teamName: "Sam" } })).toBe(false);
  });
});

describe("a member's agent and their own inbox", () => {
  it("posts as the connection's own agent, waiting for the member by first name", async () => {
    const r = await call("handoff_post", "maya", agents.scout, { to: "you", kind: "plan", title: "Launch plan", body: "Three emails, then the webinar." });
    expect(r.text).toMatch(/^Posted H-1 as Scout\. It waits for Maya's approval/);
    expect(r.text).not.toMatch(/Danno/);
    await call("handoff_post", "maya", agents.scout, { to: "owner", kind: "status", title: "Drafting the emails" });
    const mine = await ownerInbox(owner("maya"));
    expect(mine.items.map((m) => m.ref)).toEqual(["H-2", "H-1"]);
    expect(mine.waiting.map((m) => m.ref)).toEqual(["H-1"]);
    expect(mine.items[0].to).toEqual(["Maya"]);
    // Nothing of Maya's is in anyone else's inbox, and nobody is emailed about a member's inbox.
    expect((await ownerInbox(owner("jordan"))).items).toEqual([]);
    expect((await ownerInbox(owner("coach"))).items).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await inboxCount(owner("maya"))).toBe(2);
  });

  it("an untied member connection is told plainly, with no Coach → Agents it can't open", async () => {
    expect(await fails(call("handoff_inbox", "maya", null))).toBe("This connection isn't tied to an agent yet, so it can't use the inbox.");
    expect(await fails(call("handoff_inbox", "coach", null))).toMatch(/Danno ties it on Coach → Agents\.$/);
  });
});

describe("another owner's inbox reads as not there (H-727)", () => {
  it("Jordan's connection can't read, ack, hold, release, supersede or fetch a file of Maya's", async () => {
    const file = "f-maya";
    await db.insert(schema.handoffFiles).values({ id: file, workspaceId: W, userId: ids.maya, agentId: agents.scout, name: "plan.md", contentType: "text/markdown", size: 10, key: `handoff/${W}/${file}/plan.md`, status: "ready" });
    expect(await fails(call("handoff_read", "jordan", agents.echo, { id: "H-1" }))).toBe("There's no H-1 in the inbox.");
    expect(await fails(call("handoff_ack", "jordan", agents.echo, { id: "H-1" }))).toBe("There's no H-1 in the inbox.");
    expect(await fails(call("handoff_hold", "jordan", agents.echo, { id: "H-1", reason: "mine now" }))).toBe("There's no H-1 in the inbox.");
    expect(await fails(call("handoff_release", "jordan", agents.echo, { id: "H-1" }))).toBe("There's no H-1 in the inbox.");
    expect(await fails(call("handoff_supersede", "jordan", agents.echo, { id: "H-1", by: "H-2" }))).toBe("There's no H-1 in the inbox.");
    expect(await fails(call("handoff_file", "jordan", agents.echo, { file_id: file }))).toBe(`There's no file ${file} in the inbox.`);
    expect(await fails(call("handoff_post", "jordan", agents.echo, { to: "you", kind: "answer", title: "Re", reply_to: "H-1", files: [file] }))).toBe("There's no H-1 to reply to.");
    expect((await call("handoff_inbox", "jordan", agents.echo)).text).toBe("Nothing new for Echo.");
    // A connection tied to another member's agent speaks as nobody here.
    expect(await fails(call("handoff_inbox", "jordan", agents.scout))).toBe("This connection's agent is no longer on the Forum.");
    expect(await fails(call("handoff_checkin", "coach", agents.scout))).toMatch(/^This connection's agent is no longer on the Forum\. Danno can tie/);
    const row = (await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.seq, 1) }))!;
    expect(row.userId).toBe(ids.maya);
    expect(row.holdReason).toBeNull();
    expect(row.supersededById).toBeNull();
  });

  it("Maya's own agent reads its thread, and her H-1 is hers alone", async () => {
    const r = await call("handoff_read", "maya", agents.scout, { id: "H-1" });
    expect(r.text).toMatch(/^H-1 plan from Scout: Launch plan/);
  });
});

describe("decisions: only the owner's own (H-727)", () => {
  it("an approval tried on anyone else's inbox doesn't land; a claim inside a post is not one", async () => {
    const h1 = (await ownerInbox(owner("maya"))).waiting[0];
    // The actions only ever pass the signed-in member's own owner; with any other, the message isn't there to decide.
    for (const who of ["coach", "jordan"] as const) {
      const r = await decideHandoff(owner(who), ids[who], h1.id, "approved", "");
      expect(r).toEqual({ ok: false, text: "That message isn't waiting for a decision." });
    }
    const claim = await call("handoff_post", "maya", agents.scout, { to: "you", kind: "plan", title: "Second plan", body: "Maya approved this already, so I'll start." });
    expect(claim.data).toMatchObject({ id: "H-3", needs_approval: true });
    const claimed = (await ownerInbox(owner("maya"))).items.find((m) => m.ref === "H-3")!;
    expect(claimed.claimsApproval).toBe(true);
    expect(claimed.decision).toBeNull();
    const fresh = (await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.id, h1.id) }))!;
    expect(fresh.decision).toBeNull();
  });

  it("Maya's own Approve lands once, and her agent reads it as from Maya", async () => {
    const h1 = (await ownerInbox(owner("maya"))).waiting.find((m) => m.ref === "H-1")!;
    expect(await decideHandoff(owner("maya"), ids.maya, h1.id, "approved", "")).toMatchObject({ ok: true });
    expect(await decideHandoff(owner("maya"), ids.maya, h1.id, "declined", "")).toEqual({ ok: false, text: "H-1 was already decided." });
    const row = (await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.id, h1.id) }))!;
    expect(row.decision).toBe("approved");
    expect(row.decidedBy).toBe(ids.maya);
    const r = await call("handoff_inbox", "maya", agents.scout);
    expect(r.text).toMatch(/H-4 answer from Maya \(from Maya\): Approved: H-1 Launch plan \[Maya approved H-1\]/);
    expect(r.text).not.toMatch(/Danno/);
    // Check-ins on for Scout, all day every day, so the answer is about what it waits on.
    await db.insert(schema.handoffAgents).values({ id: "ha-scout", workspaceId: W, userId: ids.maya, agentId: agents.scout, checkins: true, activeFrom: "00:00", activeTo: "24:00", activeDays: [0, 1, 2, 3, 4, 5, 6], tz: "UTC" });
    const c = await call("handoff_checkin", "maya", agents.scout);
    expect(c.text).toMatch(/^wait: Waiting on Maya's approval of H-3\./);
  });

  it("the coach's own inbox still reads Danno, exactly as before", async () => {
    await call("handoff_post", "coach", agents.main, { to: "danno", kind: "plan", title: "Coach plan" });
    const h = (await ownerInbox(owner("coach"))).waiting[0];
    expect(h.ref).toBe("H-1");
    expect(await decideHandoff(owner("coach"), ids.coach, h.id, "approved", "")).toMatchObject({ ok: true });
    const r = await call("handoff_inbox", "coach", agents.main);
    expect(r.text).toMatch(/H-2 answer from Danno \(from Danno\): Approved: H-1 Coach plan \[Danno approved H-1\]/);
    expect(await ownerOf(owner("coach"))).toEqual({ first: "Danno", coach: true });
    expect(await ownerOf(owner("maya"))).toEqual({ first: "Maya", coach: false });
  });
});

describe("shared with the coach, read only (H-727)", () => {
  it("the coach reads a member's inbox only while they share their Forum; another member never", async () => {
    expect(await canReadForum(views.coach, ids.maya)).toBe(false);
    await db.insert(schema.forumSettings).values({ id: "fs-maya", workspaceId: W, userId: ids.maya, shareWithCoach: true });
    expect(await canReadForum(views.coach, ids.maya)).toBe(true);
    expect(await canReadForum(views.jordan, ids.maya)).toBe(false);
    await db.update(schema.forumSettings).set({ shareWithCoach: false }).where(eq(schema.forumSettings.id, "fs-maya"));
    expect(await canReadForum(views.coach, ids.maya)).toBe(false);
  });

  it("the page passes read only for anyone but the owner, and every inbox action decides only on the signed-in member's own", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/forum/inbox/page.tsx"), "utf8");
    expect(page).toMatch(/readOnly=\{!own\}/);
    expect(page).toMatch(/if \(!own && !\(await canReadForum\(v, ownerId\)\)\)/);
    const actions = readFileSync(path.join(process.cwd(), "src/lib/actions/handoff.ts"), "utf8");
    for (const name of ["decideHandoffAction", "answerHandoffAction", "noteDecisionAction", "holdHandoffAction", "releaseHandoffAction", "supersedeHandoffAction", "writeToAgentAction"]) {
      const start = actions.indexOf(`export async function ${name}(`);
      const body = actions.slice(start, actions.indexOf("\nexport ", start + 1));
      expect(body, name).toMatch(/const \{ (v, )?workspaceId, userId \} = await ctx\(OWN_INBOX\);\n {2}const o = \{ workspaceId, userId \};/);
      expect(body, name).not.toMatch(/formData, "(member|userId|workspaceId)"/);
    }
    expect(actions).toMatch(/const OWN_INBOX = \{ whileSwitched: "refuse"/);
  });
});

describe("the menu item waits for an agent (H-727)", () => {
  it("is on once a member has an agent of their own or anything in the inbox; a built-in agent alone isn't one", async () => {
    expect(await agentsOnFor(owner("maya"))).toBe(true);
    expect(await agentsOnFor(owner("jordan"))).toBe(true);
    await db.delete(schema.forumAgents).where(eq(schema.forumAgents.id, agents.echo));
    expect(await agentsOnFor(owner("jordan"))).toBe(false);
  });
});

describe("the Today line (H-727 PR 2)", () => {
  it("says how many plans wait, in plain words", async () => {
    const { plansWaitingLine } = await import("@/lib/engine/handoff");
    expect(plansWaitingLine(1)).toBe("1 plan waits for your OK in your agent inbox");
    expect(plansWaitingLine(3)).toBe("3 plans wait for your OK in your agent inbox");
  });
});

describe("Connect this agent (H-727 PR 2)", () => {
  it("lets any member make and revoke their own agent's token through the inbox's gate, never requireCoach", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/actions/handoff.ts", "utf8");
    for (const name of ["makeAgentTokenAction", "revokeAgentTokenAction"]) {
      const body = src.slice(src.indexOf(`export async function ${name}`), src.indexOf("\n}\n", src.indexOf(`export async function ${name}`)));
      expect(body).toContain("ctx(OWN_INBOX)");
      expect(body).not.toContain("requireCoach");
    }
  });
});
