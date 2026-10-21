"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { SCREENSHOT_MAX_BYTES, readReport, reportScreenshotKey, sniffImage } from "@/lib/engine/reports";
import { proofStorageConfigured, putReportObject } from "@/lib/proof-storage";
import { redactUrls } from "@/lib/engine/storage-policy";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { addReceipt, followUp, sendReply } from "@/lib/report-replies";
import { coachFirstName } from "@/lib/queries/reports";
import { REPLY_STATUSES } from "@/lib/engine/report-status";
import { redirect } from "next/navigation";

export type SendResult = { ok: true; screenshot: "kept" | "none" | "not-stored" } | { ok: false; error: string; field?: string };

/**
 * "I have an issue or a suggestion" (rev 432 items 2 and 3): the member's words, the page they were on, the colour, and an
 * optional screenshot, into their coach's inbox. The screenshot is checked by its bytes and kept in the private store; if the
 * store isn't set up or refuses, the report is still sent and says the picture wasn't kept. Refused while a coach is switched in.
 */
export async function sendReportAction(formData: FormData): Promise<SendResult> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "An issue or a suggestion is {first}'s own to send." });
  const read = readReport({ kind: str(formData, "kind"), severity: str(formData, "severity"), description: str(formData, "description"), page: str(formData, "page"), question: str(formData, "question"), answer: str(formData, "answer"), talkToCoach: formData.get("talkToCoach") === "on" });
  if ("error" in read) return { ok: false, error: read.error, field: read.field };
  const id = newId();
  let shot: { key: string; url: string; type: string } | null = null;
  let screenshot: "kept" | "none" | "not-stored" = "none";
  const file = formData.get("screenshot");
  if (file instanceof File && file.size > 0) {
    if (file.size > SCREENSHOT_MAX_BYTES) return { ok: false, error: "That picture is too large. Try a smaller one, or send it without.", field: "screenshot" };
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) return { ok: false, error: "The screenshot has to be a picture (PNG, JPEG, WebP or GIF).", field: "screenshot" };
    if (!proofStorageConfigured()) screenshot = "not-stored";
    else {
      try {
        const o = await putReportObject(reportScreenshotKey(workspaceId, id, kind.ext), bytes, kind.mime);
        shot = { key: o.key, url: o.url, type: kind.mime };
        screenshot = "kept";
      } catch (e) {
        console.error("[reports] screenshot not stored", redactUrls(JSON.stringify({ message: e instanceof Error ? e.message.slice(0, 300) : String(e) })));
        screenshot = "not-stored";
      }
    }
  }
  await db.insert(schema.memberReports).values({ id, workspaceId, userId, ...read.value, screenshotKey: shot?.key ?? null, screenshotUrl: shot?.url ?? null, screenshotType: shot?.type ?? null });
  // The instant receipt (H-202): on the report at once, never emailed.
  await addReceipt({ workspaceId, userId }, id, await coachFirstName(workspaceId));
  refresh();
  return { ok: true, screenshot };
}

/** The coach's Seen and Done, each a toggle; Done marks it seen too. Only a report of the coach's own workspace. */
export async function markReportAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const workspaceId = v.workspace.id;
  const id = str(formData, "reportId");
  const what = str(formData, "mark");
  const r = await db.query.memberReports.findFirst({ where: and(eq(schema.memberReports.id, id), eq(schema.memberReports.workspaceId, workspaceId)) });
  if (!r) return;
  // A quiet mark, with no message (H-202 keeps it beside the replies): the status follows it.
  const set =
    what === "seen"
      ? { seenAt: r.seenAt ? null : nowIso(), status: r.seenAt ? ("new" as const) : ("seen" as const) }
      : what === "done"
        ? { doneAt: r.doneAt ? null : nowIso(), seenAt: r.seenAt ?? nowIso(), status: r.doneAt ? ("seen" as const) : ("done" as const) }
        : null;
  if (!set) return;
  await db.update(schema.memberReports).set(set).where(and(eq(schema.memberReports.id, r.id), eq(schema.memberReports.workspaceId, workspaceId)));
  refresh();
}

/**
 * The coach's reply with a status (H-202): the words as edited, sent with Send, logged on the report; Done and Not now refused
 * until their blank is filled. Only a report of the coach's own workspace.
 */
export async function sendReplyAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const id = str(formData, "reportId");
  const status = REPLY_STATUSES.find((s) => s === str(formData, "status"));
  const back = `/coach/reports${str(formData, "tab") ? `?tab=${encodeURIComponent(str(formData, "tab"))}` : ""}`;
  if (!status) redirect(`${back}#r-${id}`);
  const out = await sendReply({ workspaceId: v.workspace.id, userId: v.user.id, name: v.user.name }, id, status, String(formData.get("message") ?? ""), str(formData, "topic") || null);
  refresh();
  const join = back.includes("?") ? "&" : "?";
  redirect(out.ok ? `${back}${join}replied=${id}#r-${id}` : `${back}${join}replyError=${encodeURIComponent(out.error)}&report=${id}#r-${id}`);
}

/** A member's follow-up on their own report (H-202): it goes back to New for the coach. Refused while a coach is switched in. */
export async function followUpAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "A follow-up is {first}'s own to send." });
  const id = str(formData, "reportId");
  const out = await followUp({ workspaceId, userId }, id, String(formData.get("text") ?? ""));
  refresh();
  redirect(out.ok ? `/reports?followed=${id}#r-${id}` : `/reports?error=${encodeURIComponent(out.error)}&report=${id}#r-${id}`);
}
