"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { allow } from "@/lib/rate-limit";
import { COACH_RESET_COOKIE, issueResetToken } from "@/lib/reset-link";
import { appUrl, brandedEmail } from "@/lib/branded-email";
import { emailConfigured } from "@/lib/email";
import { logSync } from "@/lib/integrations";
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
  const c = comebackEmail(user.name.split(" ")[0], { morning: m.reminderHour, evening: m.eveningReminderHour }, process.env.APP_URL ?? "http://localhost:3000");
  try {
    await sendEmail(user.email, c.subject, c.text, c.html);
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

/** The coach's own membership row for a client in their workspace, or nothing. Never trusts the request for the workspace. */
async function clientOf(coachWorkspaceId: string, membershipId: string) {
  return db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coachWorkspaceId), eq(schema.memberships.role, "client")) });
}

/**
 * The coach issues a password-reset link for a client, on the same single-use 60-minute machinery as the client's own /forgot.
 * With email configured it sends the branded reset email; without it, it hands the coach the link to copy (left in a cookie
 * for the coach's own next load, never in the URL). The coach never sets or sees a password. Who sent it and when is logged,
 * never the token. Rate-limited per coach.
 */
export async function sendClientResetAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const m = await clientOf(coach.workspace.id, membershipId);
  if (!m) redirect("/coach");
  if (!(await allow(`coachreset:${coach.user.id}`, 20, 15 * 60000))) redirect(`/coach/${membershipId}?reset=rate`);
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!user) redirect("/coach");
  const token = await issueResetToken(user.id);
  const link = `${appUrl()}/reset/${token}`;
  const sent = emailConfigured();
  // The log holds who and when and a reason, never the token or the link.
  await logSync({ workspaceId: coach.workspace.id, userId: user.id, provider: "account", direction: "out", event: "password_reset.sent", payload: { by: coach.user.name }, status: sent ? "sent" : "skipped", note: `Reset link issued by ${coach.user.name}` });
  if (sent) {
    const mail = brandedEmail(
      {
        subject: "Reset your HelixOS password",
        preheader: "Your coach sent you a reset link. Good for 60 minutes.",
        greeting: `Hi ${user.name.split(" ")[0]},`,
        stateLine: null,
        asks: [`${coach.user.name} sent you a link to reset your HelixOS password. Open it within 60 minutes:`],
        buttonLabel: "Reset my password",
        pointsLine: "Using this link signs you out of every other device.",
        path: `/reset/${token}`,
        footerText: "If you weren't expecting this, contact your coach.",
      },
      { settingsLink: false },
    );
    try {
      await sendEmail(user.email, mail.subject, mail.text, mail.html);
    } catch (e) {
      console.error("[coach] reset email send failed", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
      redirect(`/coach/${membershipId}?reset=failed`);
    }
    redirect(`/coach/${membershipId}?reset=emailed`);
  }
  // No email configured: hand the coach the link to copy. In a cookie for their own next load, so the token never rides in a URL.
  (await cookies()).set(COACH_RESET_COOKIE, JSON.stringify({ membershipId, link }), { httpOnly: false, sameSite: "lax", maxAge: 300, path: "/coach" });
  redirect(`/coach/${membershipId}?reset=copy`);
}

/** Soft-remove a client: access ends on the next request, reminders stop, they drop out of the coach's counts. The data stays. */
export async function removeClientAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const m = await clientOf(coach.workspace.id, membershipId);
  if (!m || m.removedAt) redirect("/coach");
  await db.update(schema.memberships).set({ removedAt: nowIso(), removedBy: coach.user.id }).where(eq(schema.memberships.id, m.id));
  await logSync({ workspaceId: coach.workspace.id, userId: m.userId, provider: "account", direction: "out", event: "client.removed", payload: { by: coach.user.name }, status: "sent", note: `Client removed by ${coach.user.name}` });
  refresh();
  redirect(deletedTo("/coach", "client"));
}

/** Undo a soft-remove: the client's access, reminders and counts all come back. */
export async function reinstateClientAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const m = await clientOf(coach.workspace.id, membershipId);
  if (!m || !m.removedAt) redirect("/coach");
  await db.update(schema.memberships).set({ removedAt: null, removedBy: null }).where(eq(schema.memberships.id, m.id));
  await logSync({ workspaceId: coach.workspace.id, userId: m.userId, provider: "account", direction: "out", event: "client.reinstated", payload: { by: coach.user.name }, status: "sent", note: `Client reinstated by ${coach.user.name}` });
  refresh();
  redirect(`/coach/${membershipId}?reinstated=1`);
}
