/**
 * Report statuses that tell the member (H-202): the receipt on submit, the coach's replies (one per status, as written and sent
 * with Send, emailed only while the member's Emails from HelixOS is on), the member's follow-ups, and what each side reads.
 * Every read and write is scoped to the workspace; a member reads only their own reports. Logs carry causes and counts only.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReportStatus } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { canEmail } from "@/lib/email-gate";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/branded-email";
import { firstName, readReply, receiptLine, topicOf, type ReplyStatus } from "@/lib/engine/report-status";

type Member = { workspaceId: string; userId: string };
type Coach = { workspaceId: string; userId: string; name: string };
const NOT_HERE = "That report isn't here any more.";

/**
 * A report, or the one it was merged into (H-202): replies, drafts and follow-ups all go to the report on top. A member's own
 * read passes their userId, so nobody reaches another member's report.
 */
export async function rootReport(workspaceId: string, reportId: string, userId?: string): Promise<schema.MemberReport | null> {
  if (!reportId) return null;
  const where = [eq(schema.memberReports.id, reportId), eq(schema.memberReports.workspaceId, workspaceId)];
  if (userId) where.push(eq(schema.memberReports.userId, userId));
  const r = await db.query.memberReports.findFirst({ where: and(...where) });
  if (!r?.parentId) return r ?? null;
  const top = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, r.parentId), eq(schema.memberReports.workspaceId, workspaceId), eq(schema.memberReports.userId, r.userId)) });
  return top ?? r;
}

/** The reports merged under one take its status (H-202): Seen, Done and the rest move together. */
export async function childrenFollow(workspaceId: string, parentId: string, status: ReportStatus): Promise<void> {
  const now = nowIso();
  await db
    .update(schema.memberReports)
    .set({
      status,
      seenAt: status === "new" ? null : sql`coalesce(${schema.memberReports.seenAt}, ${now})`,
      doneAt: status === "done" ? sql`coalesce(${schema.memberReports.doneAt}, ${now})` : null,
    })
    .where(and(eq(schema.memberReports.workspaceId, workspaceId), eq(schema.memberReports.parentId, parentId)));
}

/**
 * Merge (H-202): one member's reports go under another of theirs. Only the same member's, never one into itself; what was
 * already under a merged report moves up with it, and a Done draft on one moves to the top when the top has none. The merged
 * ones take the top one's status at once.
 */
export async function mergeReports(workspaceId: string, intoId: string, ids: string[]): Promise<{ ok: true; merged: number } | { ok: false; error: string }> {
  const into = await rootReport(workspaceId, intoId);
  if (!into) return { ok: false, error: NOT_HERE };
  const want = [...new Set(ids.map((x) => x.trim()).filter(Boolean))].filter((x) => x !== into.id);
  if (!want.length) return { ok: false, error: "Tick at least one report to merge into this one." };
  const rows = await db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, workspaceId), inArray(schema.memberReports.id, want)) });
  if (rows.length !== want.length) return { ok: false, error: "One of those reports isn't here any more." };
  if (rows.some((r) => r.userId !== into.userId)) return { ok: false, error: "Only reports from the same member can be merged." };
  const draft = !into.doneDraft ? rows.filter((r) => r.doneDraft).sort((a, b) => (b.doneDraftAt ?? "").localeCompare(a.doneDraftAt ?? ""))[0] : undefined;
  await db
    .update(schema.memberReports)
    .set({ parentId: into.id, doneDraft: null, doneDraftBy: null, doneDraftAt: null })
    .where(and(eq(schema.memberReports.workspaceId, workspaceId), or(inArray(schema.memberReports.id, want), inArray(schema.memberReports.parentId, want))));
  if (draft) await db.update(schema.memberReports).set({ doneDraft: draft.doneDraft, doneDraftBy: draft.doneDraftBy, doneDraftAt: draft.doneDraftAt }).where(and(eq(schema.memberReports.id, into.id), eq(schema.memberReports.workspaceId, workspaceId)));
  await childrenFollow(workspaceId, into.id, into.status);
  return { ok: true, merged: rows.length };
}

/** Take a merged report back out (H-202): it stands on its own again, with the status it has now. */
export async function unmergeReport(workspaceId: string, reportId: string): Promise<boolean> {
  const r = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, reportId), eq(schema.memberReports.workspaceId, workspaceId)) });
  if (!r?.parentId) return false;
  await db.update(schema.memberReports).set({ parentId: null }).where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, workspaceId)));
  return true;
}

/** The instant receipt (H-202): on the report as soon as it is sent; never emailed. */
export async function addReceipt(m: Member, reportId: string, coach: string): Promise<void> {
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: m.workspaceId, reportId, userId: m.userId, byUserId: null, kind: "receipt", body: receiptLine(coach) });
}

/** The coach's reply with a status: refused with a reason in words, or sent once (the same words twice in a minute go once). */
export async function sendReply(coach: Coach, reportId: string, status: ReplyStatus, raw: string, topic: string | null, draftedBy: string | null = null): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  // A reply on a merged report answers the one it sits under, so the member hears it once (H-202).
  const r = await rootReport(coach.workspaceId, reportId);
  if (!r) return { ok: false, error: NOT_HERE };
  const read = readReply(status, raw);
  if ("error" in read) return { ok: false, error: read.error };
  const last = await db.query.reportMessages.findFirst({ where: and(eq(schema.reportMessages.reportId, r.id), eq(schema.reportMessages.kind, "status")), orderBy: desc(schema.reportMessages.createdAt) });
  if (last && last.status === status && last.body === read.text && Date.now() - Date.parse(`${last.createdAt.replace(" ", "T")}Z`) < 60_000) return { ok: true, emailed: last.emailed };
  const now = nowIso();
  const cleanTopic = topic?.trim().slice(0, 80) || null;
  await db
    .update(schema.memberReports)
    .set({ status, topic: cleanTopic ?? r.topic, seenAt: r.seenAt ?? now, doneAt: status === "done" ? (r.doneAt ?? now) : null, ...(status === "done" ? { doneDraft: null, doneDraftBy: null, doneDraftAt: null } : {}) })
    .where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, coach.workspaceId)));
  await childrenFollow(coach.workspaceId, r.id, status);
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
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: coach.workspaceId, reportId: r.id, userId: r.userId, byUserId: coach.userId, kind: "status", status, body: read.text, emailed, draftedBy });
  return { ok: true, emailed };
}

export type DraftResult = { ok: true; sent: false; reportId: string } | { ok: true; sent: true; emailed: boolean; reportId: string } | { ok: false; error: string };

/**
 * An agent's Done note (H-202), written after its fix merged: an amber draft on the report on top, until the coach presses Send.
 * With "Send Done messages automatically after merge" on, it goes at once from the coach's account, logged as drafted by that
 * agent; a report already Done keeps it as a draft, so nothing goes twice on its own.
 */
export async function saveDoneDraft(coach: Coach, reportId: string, raw: string, agentName: string): Promise<DraftResult> {
  const r = await rootReport(coach.workspaceId, reportId);
  if (!r) return { ok: false, error: NOT_HERE };
  const read = readReply("done", raw);
  if ("error" in read) return { ok: false, error: read.error };
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, coach.workspaceId), columns: { autoDoneAfterMerge: true } });
  if (ws?.autoDoneAfterMerge && r.status !== "done") {
    const out = await sendReply(coach, r.id, "done", read.text, null, agentName);
    return out.ok ? { ok: true, sent: true, emailed: out.emailed, reportId: r.id } : out;
  }
  await db
    .update(schema.memberReports)
    .set({ doneDraft: read.text, doneDraftBy: agentName.slice(0, 100), doneDraftAt: nowIso() })
    .where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, coach.workspaceId)));
  return { ok: true, sent: false, reportId: r.id };
}

/** A member's follow-up on their own report: it goes back to New, so the coach sees it again. */
export async function followUp(m: Member, reportId: string, raw: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // On a merged report, the follow-up goes to the one on top, which the coach sees (H-202).
  const r = await rootReport(m.workspaceId, reportId, m.userId);
  if (!r) return { ok: false, error: NOT_HERE };
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "Write your follow-up first." };
  await db.insert(schema.reportMessages).values({ id: newId(), workspaceId: m.workspaceId, reportId: r.id, userId: m.userId, byUserId: m.userId, kind: "followup", body: text });
  await db.update(schema.memberReports).set({ status: "new", seenAt: null, doneAt: null }).where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, m.workspaceId)));
  await childrenFollow(m.workspaceId, r.id, "new");
  return { ok: true };
}

/** `merged`: the reports merged under this one (H-202), oldest first. */
export type ReportThread = { report: schema.MemberReport; messages: schema.ReportMessage[]; merged: schema.MemberReport[] };

/** A member's own reports on top, newest first, each with what was said on it, oldest first, and what was merged under it. */
export async function myReports(m: Member): Promise<ReportThread[]> {
  const reports = await db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, m.workspaceId), eq(schema.memberReports.userId, m.userId), isNull(schema.memberReports.parentId)), orderBy: desc(schema.memberReports.createdAt), limit: 100 });
  return withMessages(m.workspaceId, reports);
}

/** Reports with their messages and the reports merged under them, for any list. */
export async function withMessages(workspaceId: string, reports: schema.MemberReport[]): Promise<ReportThread[]> {
  const ids = reports.map((r) => r.id);
  const [msgs, children] = ids.length
    ? await Promise.all([
        db.query.reportMessages.findMany({ where: and(eq(schema.reportMessages.workspaceId, workspaceId), inArray(schema.reportMessages.reportId, ids)) }),
        db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, workspaceId), inArray(schema.memberReports.parentId, ids)) }),
      ])
    : [[], []];
  return reports.map((report) => ({
    report,
    messages: msgs.filter((x) => x.reportId === report.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    merged: children.filter((c) => c.parentId === report.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
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
