"use server";

/**
 * The Handoff inbox (rev 769): the owner's own actions, signed in. Agent tokens (made, shown once, revoked), tying a connection
 * to an agent, the approval-email switch, Danno's answers, and the only door to a decision: Approve, Change or Decline, here
 * and on The Forum. A coach switched into a client is that client here, and requireCoach turns them away.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { agentSettings, answerHandoff, decideHandoff, makeAgentToken, revokeAgentTokens, tieConnection, writeAsOwner } from "@/lib/handoff";
import { CHECKIN_DEFAULTS, CHECKIN_EVERY, hhmm } from "@/lib/engine/handoff";
import { forumSettingsFor } from "@/lib/forum";

export type HandoffFormState = { error?: string; ok?: string; token?: string; agent?: string } | null;

export async function makeAgentTokenAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const coach = await requireCoach();
  const agentId = str(formData, "agentId");
  const token = await makeAgentToken({ workspaceId: coach.workspace.id, userId: coach.user.id, membershipId: coach.membership.id }, agentId);
  refresh();
  if (!token) return { error: "That agent isn't on your Forum." };
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, coach.workspace.id), eq(schema.forumAgents.userId, coach.user.id), eq(schema.forumAgents.id, agentId)), columns: { name: true } });
  return { token, agent: agent?.name, ok: "Copy it now: it won't be shown again." };
}

export async function revokeAgentTokenAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await revokeAgentTokens({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "agentId"));
  refresh();
}

export async function tieConnectionAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await tieConnection({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "appId"), str(formData, "agentId") || null);
  refresh();
}

/** Approve, Change (with what to change) or Decline: one tap, Danno's own, signed in. */
export async function decideHandoffAction(_prev: HandoffFormState, formData: FormData): Promise<HandoffFormState> {
  const coach = await requireCoach();
  const choice = str(formData, "decision");
  const decision = choice === "approved" || choice === "changed" || choice === "declined" ? choice : null;
  if (!decision) return { error: "Choose Approve, Change or Decline." };
  const r = await decideHandoff({ workspaceId: coach.workspace.id, userId: coach.user.id }, coach.actor.id, str(formData, "id"), decision, String(formData.get("note") ?? "").trim());
  refresh();
  return r.ok ? { ok: r.text } : { error: r.text };
}

export async function answerHandoffAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await answerHandoff({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "id"), String(formData.get("body") ?? ""));
  refresh();
}

export async function setApprovalEmailsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = { workspaceId: coach.workspace.id, userId: coach.user.id };
  await forumSettingsFor(m);
  await db.update(schema.forumSettings).set({ approvalEmails: str(formData, "on") === "1" }).where(and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId)));
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
  const link = str(formData, "sessionUrl");
  let sessionUrl: string | null = null;
  try {
    const u = new URL(link);
    if (u.protocol === "https:" && !u.username && !u.password) sessionUrl = u.toString().slice(0, 300);
  } catch {
    sessionUrl = null;
  }
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

/** Danno writes to one agent; urgent gets past a busy check-in. */
export async function writeToAgentAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const kind = str(formData, "kind") === "answer" ? "answer" : "brief";
  await writeAsOwner({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "agentId"), kind, str(formData, "title"), String(formData.get("body") ?? ""), formData.get("urgent") === "on");
  refresh();
}
