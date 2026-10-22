"use server";

/**
 * The Handoff inbox (rev 769): the owner's own actions, signed in. Agent tokens (made, shown once, revoked) are any member's on
 * their own Forum since H-727 PR 2; tying a connection to an agent, the approval-email switch and check-ins stay the coach's
 * (requireCoach). The owner's answers, notes, writing to
 * an agent, Hold, Release and Superseded, and the only door to a decision (Approve, Change or Decline, on the inbox and on The
 * Forum) are any member's on their own inbox (H-727), through ctx(). Each acts only on the signed-in member's own inbox. A
 * coach switched into a client, and a team member, are turned away from both.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { agentSettings, answerHandoff, decideHandoff, tickNeed, makeAgentToken, noteDecision, revokeAgentTokens, sendReadingPack, tieConnection, writeAsOwner, refusalOf, holdHandoff, releaseHandoff, supersedeHandoff } from "@/lib/handoff";
import { CHECKIN_DEFAULTS, CHECKIN_EVERY, cleanSessionUrl, hhmm } from "@/lib/engine/handoff";
import { forumSettingsFor } from "@/lib/forum";
import { PING_TITLE } from "@/lib/engine/agent-connection";

export type HandoffFormState = { error?: string; ok?: string; token?: string; agent?: string } | null;

/**
 * The inbox's owner (H-727), any role, through the gate: ctx() refuses a coach switched into a client (an inbox is its owner's
 * own) and a team member. The owner is always the signed-in member themselves, never an id from the form, so a decision can
 * only ever land on one's own inbox.
 */
const OWN_INBOX = { whileSwitched: "refuse", reason: "{first}'s agent inbox is theirs alone: only {first} decides there." } as const;

/**
 * Connect this agent (H-727 PR 2): any member makes their own agent's token, on their own Forum (the coach's are on Coach →
 * Agents). Through the inbox's gate, so a coach switched into a client and a team member are turned away; the token is bound
 * to the signed-in member and carries The Forum and the inbox only.
 */
export async function makeAgentTokenAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { v, workspaceId, userId } = await ctx(OWN_INBOX);
  const agentId = str(formData, "agentId");
  const token = await makeAgentToken({ workspaceId, userId, membershipId: v.membership.id }, agentId);
  refresh();
  if (!token) return { error: "That agent isn't on your Forum." };
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, workspaceId), eq(schema.forumAgents.userId, userId), eq(schema.forumAgents.id, agentId)), columns: { name: true } });
  return { token, agent: agent?.name, ok: "Copy it now: it won't be shown again." };
}

export async function revokeAgentTokenAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  await revokeAgentTokens({ workspaceId, userId }, str(formData, "agentId"));
  refresh();
}

/** Check connection (H-559): re-read the agent's token, last tool, failures and ping, and say when it was checked. */
export async function checkAgentConnectionAction(formData: FormData): Promise<void> {
  await requireCoach();
  const agentId = str(formData, "agentId");
  redirect(`/coach/agents?checked=${encodeURIComponent(agentId)}&at=${Date.now()}#agent-${encodeURIComponent(agentId)}`);
}

/** Ping (H-559): an ordinary inbox message from the coach that the agent answers with handoff_ack. */
export async function pingAgentAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const agentId = str(formData, "agentId");
  await writeAsOwner({ workspaceId: coach.workspace.id, userId: coach.user.id }, agentId, "question", PING_TITLE, "", false);
  redirect(`/coach/agents?pinged=${encodeURIComponent(agentId)}#agent-${encodeURIComponent(agentId)}`);
}

export async function tieConnectionAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await tieConnection({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "appId"), str(formData, "agentId") || null);
  refresh();
}

/** Approve, Change (with what to change) or Decline: one tap, the owner's own, signed in. */
export async function decideHandoffAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { v, workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  const choice = str(formData, "decision");
  const decision = choice === "approved" || choice === "changed" || choice === "declined" ? choice : null;
  if (!decision) return { error: "Choose Approve, Change or Decline." };
  const r = await decideHandoff(o, v.actor.id, str(formData, "id"), decision, String(formData.get("note") ?? "").trim());
  refresh();
  return r.ok ? { ok: r.text } : { error: r.text };
}

/** H-1494: the owner ticks a "needs you" item on the Inbox, Done or Not needed; either way it leaves the list. */
export async function tickInboxNeedAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  await tickNeed({ workspaceId, userId }, str(formData, "id"));
  refresh();
}

export async function answerHandoffAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  await answerHandoff(o, str(formData, "id"), String(formData.get("body") ?? ""));
  refresh();
}

export async function setApprovalEmailsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = { workspaceId: coach.workspace.id, userId: coach.user.id };
  await forumSettingsFor(m);
  await db.update(schema.forumSettings).set({ approvalEmails: str(formData, "on") === "1" }).where(and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId)));
  refresh();
}

/** Coach → Inbox (H-495): an email to the owner's own address when an agent stops checking in. Off until turned on. */
export async function setStallEmailsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = { workspaceId: coach.workspace.id, userId: coach.user.id };
  await forumSettingsFor(m);
  await db.update(schema.forumSettings).set({ stallEmails: str(formData, "on") === "1" }).where(and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId)));
  refresh();
}

/** Coach → Agents: one agent's scheduled check-ins (13 Oct): on or off, how often, active hours, the session link. */
export async function saveAgentCheckinsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const o = { workspaceId: coach.workspace.id, userId: coach.user.id };
  const agentId = str(formData, "agentId");
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!agent || agent.builtIn) return;
  const s = await agentSettings(o, agent.id);
  const every = Number(str(formData, "every"));
  const days = formData.getAll("days").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const tz = str(formData, "tz");
  const sessionUrl = cleanSessionUrl(str(formData, "sessionUrl"));
  await db
    .update(schema.handoffAgents)
    .set({
      checkins: formData.get("checkins") === "on",
      everyMinutes: (CHECKIN_EVERY as readonly number[]).includes(every) ? every : CHECKIN_DEFAULTS.everyMinutes,
      activeFrom: hhmm(str(formData, "from")) ?? s.activeFrom,
      activeTo: hhmm(str(formData, "to")) ?? s.activeTo,
      activeDays: days.length ? [...new Set(days)].sort() : s.activeDays,
      tz: validZone(tz) ? tz : s.tz,
      sessionUrl,
    })
    .where(eq(schema.handoffAgents.id, s.id));
  refresh();
}

const validZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz.length > 0 && tz.length < 60;
  } catch {
    return false;
  }
};

/** Pause all: every agent's check-in answers quiet until it's turned back on. */
export async function setCheckinsPausedAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = { workspaceId: coach.workspace.id, userId: coach.user.id };
  await forumSettingsFor(m);
  await db.update(schema.forumSettings).set({ checkinsPaused: str(formData, "on") === "1" }).where(and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId)));
  refresh();
}

/** The owner writes to one of their own agents; urgent gets past a busy check-in. */
export async function writeToAgentAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  const kind = str(formData, "kind") === "answer" ? "answer" : "brief";
  await writeAsOwner(o, str(formData, "agentId"), kind, str(formData, "title"), String(formData.get("body") ?? ""), formData.get("urgent") === "on");
  refresh();
}

/** Start this agent (H-26 C): a reading pack from Danno to one agent, files and all, from his own page only. */
export async function sendReadingPackAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const files: { name: string; bytes: Buffer; type?: string }[] = [];
  for (const f of formData.getAll("files")) {
    if (!(f instanceof File) || !f.name || !f.size) continue;
    files.push({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()), type: f.type });
  }
  const r = await sendReadingPack({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "agentId"), str(formData, "title"), String(formData.get("body") ?? ""), files);
  refresh();
  if (!r.ok) redirect(`/coach/agents?error=${encodeURIComponent(r.text)}#agent-${str(formData, "agentId")}`);
  redirect(`/coach/agents?pack=${r.seq}&packFor=${str(formData, "agentId")}#agent-${str(formData, "agentId")}`);
}

/** A note after a decision (H-47), from the owner's own inbox only. */
export async function noteDecisionAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  const r = await noteDecision(o, str(formData, "id"), String(formData.get("note") ?? ""));
  refresh();
  return r.ok ? { ok: r.text } : { error: r.text };
}

// H-351: the owner's own Hold, Release and Supersede on any post in their inbox.
export async function holdHandoffAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  try {
    const text = await holdHandoff(o, null, str(formData, "ref"), str(formData, "reason"));
    refresh();
    return { ok: text };
  } catch (e) {
    const said = refusalOf(e);
    if (said) return { error: said };
    throw e;
  }
}

export async function releaseHandoffAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  try {
    const text = await releaseHandoff(o, null, str(formData, "ref"));
    refresh();
    return { ok: text };
  } catch (e) {
    const said = refusalOf(e);
    if (said) return { error: said };
    throw e;
  }
}

export async function supersedeHandoffAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const { workspaceId, userId } = await ctx(OWN_INBOX);
  const o = { workspaceId, userId };
  try {
    const text = await supersedeHandoff(o, null, str(formData, "ref"), str(formData, "by"));
    refresh();
    return { ok: text };
  } catch (e) {
    const said = refusalOf(e);
    if (said) return { error: said };
    throw e;
  }
}
