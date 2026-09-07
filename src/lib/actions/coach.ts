"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { sendEmail } from "@/lib/email";
import { comebackEmail } from "@/lib/reminders";
import { nowIso, todayInTz } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { addDays } from "@/lib/dates";
import { parseTaskLines, TASK_SOURCES } from "@/lib/engine/notes";
import { assignTasks } from "@/lib/queries/tasks";
import { award, totalPoints } from "@/lib/queries/points";
import { ADJUST_CAP } from "@/lib/engine/points";

export async function setClientPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const enabled = str(formData, "enabled") === "1";
  const tier = str(formData, "programTier");
  await db
    .update(schema.memberships)
    .set({ passEnabled: enabled, ...(tier ? { programTier: tier } : {}) })
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}

/** Sends the comeback email to one quiet client right now, at most once a day. The nudge is logged on the membership. */
export async function nudgeMemberAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) return;
  if (m.lastNudgedAt && Date.now() - new Date(m.lastNudgedAt).getTime() < 20 * 3600_000) return;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!user) return;
  const today = todayInTz(m.timezone || coach.workspace.timezone);
  const c = comebackEmail(user.name.split(" ")[0], today, process.env.APP_URL ?? "http://localhost:3000");
  try {
    await sendEmail(user.email, c.subject, c.text);
    await db.update(schema.memberships).set({ lastNudgedAt: nowIso(), lastComebackAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  } catch (e) {
    console.error(`[coach] nudge to ${m.userId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  refresh();
}

/**
 * What was decided on a call, written once by the coach, becomes work in the client's own Today and Tasks. The note is
 * kept on the membership; each task line becomes a task with source "coach_call" pointing back at the note.
 */
export async function addCoachNoteAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) return;
  const body = str(formData, "body");
  const lines = parseTaskLines(str(formData, "tasks"));
  if (!body && !lines.length) return;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(formData, "date")) ? str(formData, "date") : coach.today;
  const clientToday = todayInTz(m.timezone || coach.workspace.timezone);
  const due = str(formData, "due");
  const dueDate = due === "tomorrow" ? addDays(clientToday, 1) : due === "week" ? addDays(clientToday, 7) : clientToday;
  const noteId = newId();
  await db.insert(schema.coachNotes).values({ id: noteId, workspaceId: coach.workspace.id, membershipId: m.id, authorUserId: coach.user.id, date, body: body || "(tasks only)" });
  await assignTasks({ workspaceId: coach.workspace.id, userId: m.userId, today: clientToday }, { source: TASK_SOURCES.coachCall, sourceRef: noteId }, lines.map((title) => ({ title, dueDate })));
  refresh();
}

export type AdjustState = { error?: string; ok?: string } | undefined;

/**
 * A coach corrects or grants a client's points: a signed bonus row through award(), never a direct ledger write. The
 * reason is required because the client reads it in their own history. Negative adjustments never take a balance below
 * zero (clamped, and said), one adjustment is capped at ±5,000, and the acting coach is recorded on the row.
 */
export async function adjustPointsAction(_prev: AdjustState, formData: FormData): Promise<AdjustState> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) return { error: "That client isn't in your workspace." };
  const reason = str(formData, "reason");
  const raw = Math.trunc(Number(str(formData, "points").replace(/[^0-9.-]/g, "")));
  if (!reason) return { error: "Say why. The client reads this line in their points history." };
  if (!Number.isFinite(raw) || raw === 0) return { error: "Enter a number of points, positive or negative." };
  if (Math.abs(raw) > ADJUST_CAP) return { error: `One adjustment is capped at ${ADJUST_CAP.toLocaleString()} points either way. Split it if you mean it.` };
  const total = await totalPoints(coach.workspace.id, m.userId);
  const points = raw < 0 && total + raw < 0 ? -total : raw;
  if (points === 0) return { error: "Their balance is already 0; there is nothing to take." };
  const refId = `adjust:${newId()}`;
  const ok = await award({ workspaceId: coach.workspace.id, userId: m.userId }, "bonus", points, reason, refId);
  if (!ok) return { error: "Nothing was written. Try again." };
  await db.update(schema.pointsLedger).set({ adjustedBy: coach.user.id }).where(and(eq(schema.pointsLedger.userId, m.userId), eq(schema.pointsLedger.type, "bonus"), eq(schema.pointsLedger.refId, refId)));
  refresh();
  const clamped = points !== raw ? ` Clamped from ${raw.toLocaleString()} so the balance stops at 0.` : "";
  return { ok: `${points > 0 ? "+" : ""}${points.toLocaleString()} points recorded.${clamped}` };
}
