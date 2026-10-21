/**
 * Report statuses that tell the member (H-202): the receipt on submit, the coach's replies (one per status, as written and sent
 * with Send, emailed only while the member's Emails from HelixOS is on), the member's follow-ups, and what each side reads.
 * Every read and write is scoped to the workspace; a member reads only their own reports. Logs carry causes and counts only.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReportStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { canEmail } from "@/lib/email-gate";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/branded-email";
import { firstName, readReply, receiptLine, topicOf, type ReplyStatus } from "@/lib/engine/report-status";

type Member = { workspaceId: string; userId: string };

/** The instant receipt (H-202): on the report as soon as it is sent; never emailed. */
export async function addReceipt(m: Member, reportId: string, coach: string): Promise<void> {
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: m.workspaceId, reportId, userId: m.userId, byUserId: null, kind: "receipt", body: receiptLine(coach) });
}

/** The coach's reply with a status: refused with a reason in words, or sent once (the same words twice in a minute go once). */
export async function sendReply(coach: { workspaceId: string; userId: string; name: string }, reportId: string, status: ReplyStatus, raw: string, topic: string | null): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  const r = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, reportId), eq(schema.memberReports.workspaceId, coach.workspaceId)) });
  if (!r) return { ok: false, error: "That report isn't here any more." };
  const read = readReply(status, raw);
  if ("error" in read) return { ok: false, error: read.error };
  const last = await db.query.reportMessages.findFirst({ where: and(eq(schema.reportMessages.reportId, r.id), eq(schema.reportMessages.kind, "status")), orderBy: desc(schema.reportMessages.createdAt) });
  if (last && last.status === status && last.body === read.text && Date.now() - Date.parse(`${last.createdAt.replace(" ", "T")}Z`) < 60_000) return { ok: true, emailed: last.emailed };
  const now = nowIso();
  const cleanTopic = topic?.trim().slice(0, 80) || null;
  await db
    .update(schema.memberReports)
    .set({ status, topic: cleanTopic ?? r.topic, seenAt: r.seenAt ?? now, doneAt: status === "done" ? (r.doneAt ?? now) : null })
    .where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, coach.workspaceId)));
  let emailed = false;
  const [membership, member] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, coach.workspaceId), eq(schema.memberships.userId, r.userId)) }),
    db.query.users.findFirst({ where: eq(schema.users.id, r.userId) }),
  ]);
  if (membership && member && (await canEmail(membership.id))) {
    const about = topicOf({ topic: cleanTopic ?? r.topic, description: r.description, question: r.question });
    try {
      await sendEmail(member.email, `${firstName(coach.name)} replied about ${about}`, `${read.text}\n\nSee it in HelixOS: ${appUrl()}/reports`);
      emailed = true;
    } catch (e) {
      console.error("[reports] reply email not sent", e instanceof Error ? e.message.slice(0, 120) : "unknown");
    }
  }
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: coach.workspaceId, reportId: r.id, userId: r.userId, byUserId: coach.userId, kind: "status", status, body: read.text, emailed });
  return { ok: true, emailed };
}

/** A member's follow-up on their own report: it goes back to New, so the coach sees it again. */
export async function followUp(m: Member, reportId: string, raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, reportId), eq(schema.memberReports.workspaceId, m.workspaceId), eq(schema.memberReports.userId, m.userId)) });
  if (!r) return { ok: false, error: "That report isn't here any more." };
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "Write your follow-up first." };
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: m.workspaceId, reportId: r.id, userId: m.userId, byUserId: m.userId, kind: "followup", body: text });
  await db.update(schema.memberReports).set({ status: "new", seenAt: null, doneAt: null }).where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, m.workspaceId)));
  return { ok: true };
}

export type ReportThread = { report: schema.MemberReport; messages: schema.ReportMessage[] };

/** A member's own reports, newest first, each with what was said on it, oldest first. */
export async function myReports(m: Member): Promise<ReportThread[]> {
  const reports = await db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, m.workspaceId), eq(schema.memberReports.userId, m.userId)), orderBy: desc(schema.memberReports.createdAt), limit: 100 });
  return withMessages(m.workspaceId, reports);
}

/** Reports with their messages, for any list. */
export async function withMessages(workspaceId: string, reports: schema.MemberReport[]): Promise<ReportThread[]> {
  const msgs = reports.length ? await db.query.reportMessages.findMany({ where: and(eq(schema.reportMessages.workspaceId, workspaceId), inArray(schema.reportMessages.reportId, reports.map((r) => r.id))) }) : [];
  return reports.map((report) => ({ report, messages: msgs.filter((x) => x.reportId === report.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }));
}

/** The coach's replies the member hasn't seen yet, newest first, for Today's line. */
export async function unreadReplies(m: Member): Promise<{ count: number; reportId: string | null }> {
  const rows = await db.query.reportMessages.findMany({ where: and(eq(schema.reportMessages.workspaceId, m.workspaceId), eq(schema.reportMessages.userId, m.userId), eq(schema.reportMessages.kind, "status"), isNull(schema.reportMessages.readAt)), orderBy: desc(schema.reportMessages.createdAt), columns: { reportId: true } });
  return { count: rows.length, reportId: rows[0]?.reportId ?? null };
}

/** My reports opened: every reply on it is read. */
export async function markRepliesRead(m: Member): Promise<void> {
  await db
    .update(schema.reportMessages)
    .set({ readAt: nowIso() })
    .where(and(eq(schema.reportMessages.workspaceId, m.workspaceId), eq(schema.reportMessages.userId, m.userId), eq(schema.reportMessages.kind, "status"), isNull(schema.reportMessages.readAt)));
}

/** Reports in one status, for the coach's tabs. */
export const countsByStatus = (rows: { status: ReportStatus }[]): Record<ReportStatus, number> => ({
  new: rows.filter((r) => r.status === "new").length,
  seen: rows.filter((r) => r.status === "seen").length,
  working: rows.filter((r) => r.status === "working").length,
  done: rows.filter((r) => r.status === "done").length,
  not_now: rows.filter((r) => r.status === "not_now").length,
});
