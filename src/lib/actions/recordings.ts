"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { RECORDING_AUDIENCES, type RecordingAudience } from "@/db/schema";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { open, seal } from "@/lib/crypto";
import { appUrl } from "@/lib/branded-email";
import { allow } from "@/lib/rate-limit";
import { createWebhook, deleteWebhook, validateFathomKey } from "@/lib/fathom";
import { TRANSCRIPT_PRESSES_PER_HOUR, shownTitle } from "@/lib/engine/recordings";
import { TASK_SOURCES } from "@/lib/engine/notes";
import { itemMoment } from "@/lib/engine/recording-members";
import { rulesFromForm, type RulesForm } from "@/lib/engine/recording-rules";
import { taskPoints } from "@/lib/engine/points";
import { fetchTranscript, markAllSeen, paceKeyFor, publishRecording, restoreRecording, reviewContext, reviewOf, skipRecording, syncRecordings, unpublishRecording, visibleRecording, workspaceFathom } from "@/lib/recordings";
import { ctx, refresh, str } from "@/lib/action-helpers";

const INTEGRATIONS = "/integrations#fathom-recordings";
const back = (q: string): never => redirect(`/integrations?fathom=${encodeURIComponent(q)}#fathom-recordings`);

/* ───────────── The workspace connection (coach, Integrations page) ───────────── */

/** Saves the coach's own Fathom key for the workspace after a real check. The first save is the switch-on date. */
export async function saveFathomWorkspaceKeyAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const key = str(formData, "fathomKey");
  if (!key) back("nokey");
  const r = await validateFathomKey(paceKeyFor(v.workspace.id), key);
  const row = { keyEncrypted: seal(key)!, last4: key.slice(-4), lastValidatedAt: r.ok ? nowIso() : null, lastError: r.ok ? null : r.error };
  const existing = await workspaceFathom(v.workspace.id);
  if (existing) await db.update(schema.fathomWorkspaceConnections).set(row).where(eq(schema.fathomWorkspaceConnections.id, existing.id));
  else await db.insert(schema.fathomWorkspaceConnections).values({ id: newId(), workspaceId: v.workspace.id, enabledAt: nowIso(), ...row });
  refresh();
  redirect(INTEGRATIONS);
}

export async function recheckFathomWorkspaceKeyAction(): Promise<void> {
  const v = await requireCoach();
  const existing = await workspaceFathom(v.workspace.id);
  if (!existing) return;
  const key = open(existing.keyEncrypted);
  if (!key) await db.update(schema.fathomWorkspaceConnections).set({ lastError: "The stored key can't be read any more. Paste it again." }).where(eq(schema.fathomWorkspaceConnections.id, existing.id));
  else {
    const r = await validateFathomKey(paceKeyFor(v.workspace.id), key);
    await db.update(schema.fathomWorkspaceConnections).set(r.ok ? { lastError: null, lastValidatedAt: nowIso() } : { lastError: r.error }).where(eq(schema.fathomWorkspaceConnections.id, existing.id));
  }
  refresh();
  redirect(INTEGRATIONS);
}

/** Disconnects: the webhook is removed at Fathom when one is registered, then the key goes. Recordings already here stay. */
export async function removeFathomWorkspaceAction(): Promise<void> {
  const v = await requireCoach();
  const existing = await workspaceFathom(v.workspace.id);
  if (!existing) return;
  const key = open(existing.keyEncrypted);
  if (existing.webhookId && key) await deleteWebhook(paceKeyFor(v.workspace.id), key, existing.webhookId);
  await db.delete(schema.fathomWorkspaceConnections).where(eq(schema.fathomWorkspaceConnections.id, existing.id));
  refresh();
  back("removed");
}

/** Registers the webhook at Fathom and seals the secret it answers with. The destination carries the connection id, never a secret. */
export async function registerFathomWebhookAction(): Promise<void> {
  const v = await requireCoach();
  const existing = await workspaceFathom(v.workspace.id);
  if (!existing) back("notconnected");
  const key = open(existing!.keyEncrypted);
  if (!key) back("badkey");
  const r = await createWebhook(paceKeyFor(v.workspace.id), key!, `${appUrl()}/api/webhooks/fathom/${existing!.id}`);
  if (!r.ok) back(`webhook:${r.error}`);
  const data = r.ok ? r.data : { id: "", secret: "" };
  await db.update(schema.fathomWorkspaceConnections).set({ webhookId: data.id, webhookSecretEncrypted: seal(data.secret), webhookRegisteredAt: nowIso() }).where(eq(schema.fathomWorkspaceConnections.id, existing!.id));
  refresh();
  back("webhook-on");
}

export async function unregisterFathomWebhookAction(): Promise<void> {
  const v = await requireCoach();
  const existing = await workspaceFathom(v.workspace.id);
  if (!existing?.webhookId) return;
  const key = open(existing.keyEncrypted);
  if (key) {
    const r = await deleteWebhook(paceKeyFor(v.workspace.id), key, existing.webhookId);
    if (!r.ok) back(`webhook:${r.error}`);
  }
  await db.update(schema.fathomWorkspaceConnections).set({ webhookId: null, webhookSecretEncrypted: null, webhookRegisteredAt: null }).where(eq(schema.fathomWorkspaceConnections.id, existing.id));
  refresh();
  back("webhook-off");
}

/** Sync now, from the Integrations card or the coach view. */
export async function syncRecordingsNowAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const from = str(formData, "from") === "coach" ? "/coach/recordings" : "/integrations";
  const r = await syncRecordings(v.workspace.id, v.user.id);
  refresh();
  redirect(r.ok ? `${from}?synced=${r.seen}-${r.created}-${r.published}${from === "/integrations" ? "#fathom-recordings" : ""}` : `${from}?error=${encodeURIComponent(r.error)}${from === "/integrations" ? "#fathom-recordings" : ""}`);
}

/* ───────────── The coach view ───────────── */

/** The coach's own workspace's recording, or undefined: every coach action below reads through this after its guard. */
const recordingIn = (workspaceId: string, id: string) => db.query.recordings.findFirst({ where: and(eq(schema.recordings.id, id), eq(schema.recordings.workspaceId, workspaceId)) });

/** Publish with one tap: the audience, or the named members for a one-to-one (at least one). */
export async function publishRecordingAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await recordingIn(v.workspace.id, str(formData, "recordingId"));
  if (!r) return;
  const audience = RECORDING_AUDIENCES.find((a) => a === str(formData, "audience")) as RecordingAudience | undefined;
  // Refused back where it was chosen: the call's own Review page, or the list.
  const back = str(formData, "from") === "review" ? `/coach/recordings/${r.id}` : "/coach/recordings";
  if (!audience) redirect(`${back}?error=${encodeURIComponent("Pick who the recording is for.")}&field=audience`);
  const members = formData.getAll("members").map(String).filter(Boolean);
  if (audience === "members" && !members.length) redirect(`${back}?error=${encodeURIComponent("Tick at least one member for a one-to-one.")}&field=members`);
  await publishRecording(r, audience!, members, v.user.id);
  refresh();
  redirect(`/coach/recordings?published=${r.id}`);
}

/** Skip (rev 488): not for members. Kept, recoverable from Skipped, never deleted from Fathom; a published call is unpublished first. */
export async function skipRecordingAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await recordingIn(v.workspace.id, str(formData, "recordingId"));
  if (!r) return;
  await skipRecording(r);
  refresh();
  redirect(`/coach/recordings?skipped=1`);
}

export async function restoreRecordingAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await recordingIn(v.workspace.id, str(formData, "recordingId"));
  if (!r) return;
  await restoreRecording(r);
  refresh();
  redirect(`/coach/recordings?tab=skipped&restored=1`);
}

/**
 * Publishing rules (rev 491): the series names and time slots, as the coach edits them. A refused row comes back with the
 * field marked and the typing kept; a saved list applies to every draft's suggestion at once, and to new calls from now on.
 */
export async function saveRecordingRulesAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const count = (k: "series_count" | "slot_count") => Math.min(60, Math.max(0, Number(str(formData, k)) || 0));
  const f: RulesForm = {
    timezone: str(formData, "timezone"),
    series: Array.from({ length: count("series_count") }, (_, i) => ({ name: str(formData, `series_name_${i}`), audience: str(formData, `series_audience_${i}`), remove: formData.get(`series_remove_${i}`) === "1" })),
    slots: Array.from({ length: count("slot_count") }, (_, i) => ({ name: str(formData, `slot_name_${i}`), day: str(formData, `slot_day_${i}`), time: str(formData, `slot_time_${i}`), audience: str(formData, `slot_audience_${i}`), remove: formData.get(`slot_remove_${i}`) === "1" })),
  };
  const r = rulesFromForm(f);
  if (!r.ok) redirect(`/coach/recordings/rules?error=${encodeURIComponent(r.error)}&field=${r.field}`);
  await db.update(schema.workspaces).set({ recordingRules: r.rules }).where(eq(schema.workspaces.id, v.workspace.id));
  refresh();
  redirect(`/coach/recordings/rules?saved=1`);
}

/**
 * The ticked drafts at once (rev 488): Publish as suggested publishes each to its suggested audience and leaves the ones with
 * no suggestion for the coach to choose; Skip skips them all. Only drafts of the coach's own workspace.
 */
export async function bulkRecordingsAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const workspaceId = v.workspace.id;
  const ids = [...new Set(formData.getAll("ids").map(String).filter(Boolean))].slice(0, 200);
  const what = str(formData, "bulk");
  if (!ids.length || (what !== "publish" && what !== "skip")) redirect(`/coach/recordings?error=${encodeURIComponent("Tick at least one call first.")}`);
  const rows = await db.query.recordings.findMany({ where: and(eq(schema.recordings.workspaceId, workspaceId), inArray(schema.recordings.id, ids), eq(schema.recordings.status, "draft")) });
  let done = 0;
  let left = 0;
  if (what === "skip") {
    for (const r of rows) {
      await skipRecording(r);
      done++;
    }
  } else {
    const c = await reviewContext(workspaceId);
    for (const r of rows) {
      const s = reviewOf(r, c).suggestion;
      if (!s || (s.audience === "members" && !s.userIds.length)) {
        left++;
        continue;
      }
      await publishRecording(r, s.audience, s.userIds, v.user.id);
      done++;
    }
  }
  refresh();
  redirect(`/coach/recordings?bulk=${what}-${done}-${left}`);
}

export async function unpublishRecordingAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await recordingIn(v.workspace.id, str(formData, "recordingId"));
  if (!r) return;
  await unpublishRecording(r);
  refresh();
  redirect(`/coach/recordings?unpublished=${r.id}#r-${r.id}`);
}

/** Hide transcript for the odd sensitive call: members see no View transcript; the coach still can. */
export async function setTranscriptHiddenAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const workspaceId = v.workspace.id;
  const r = await recordingIn(workspaceId, str(formData, "recordingId"));
  if (!r) return;
  await db.update(schema.recordings).set({ transcriptHidden: str(formData, "hidden") === "1" }).where(and(eq(schema.recordings.id, r.id), eq(schema.recordings.workspaceId, workspaceId)));
  refresh();
}

/** The coach pre-fetches a transcript so the first member to ask opens it from HelixOS. */
export async function prefetchTranscriptAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await recordingIn(v.workspace.id, str(formData, "recordingId"));
  if (!r) return;
  const t = await fetchTranscript(r, v.user.id, "coach");
  refresh();
  redirect(t.ok ? `/coach/recordings?fetched=${r.id}#r-${r.id}` : `/coach/recordings?error=${encodeURIComponent(t.error)}#r-${r.id}`);
}

/* ───────────── The member's side ───────────── */

const OWN = "The transcript and the steps are {first}'s own: a transcript fetched from here would spend the coach's Fathom calls under their name.";

/**
 * View transcript: the first press fetches it with the coach's key and keeps it; later presses open what is kept. Ten presses an
 * hour per member; every fetch is logged. Refused while switched.
 */
export async function viewTranscriptAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(formData, "recordingId");
  const r = await visibleRecording(workspaceId, id, { userId, programTier: v.membership.programTier, role: v.role });
  if (!r) redirect("/recordings");
  if (r!.transcriptHidden && v.role !== "coach") redirect(`/recordings/${id}`);
  if (!r!.transcript && !(await allow(`transcript:${userId}`, TRANSCRIPT_PRESSES_PER_HOUR, 3600_000))) redirect(`/recordings/${id}?error=${encodeURIComponent("That's ten transcripts in an hour. Try again in a little while.")}`);
  const t = await fetchTranscript(r!, userId, "member");
  refresh();
  redirect(t.ok ? `/recordings/${id}?transcript=1#transcript` : `/recordings/${id}?error=${encodeURIComponent(t.error)}#transcript`);
}

/** "Mark all as seen" (rev 498): every recording the member can see stops being new for them. Refused while switched. */
export async function markAllSeenAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const n = await markAllSeen(workspaceId, { userId, programTier: v.membership.programTier, role: v.role });
  refresh();
  redirect(`/recordings?seen=${n}`);
}

/** One tap turns an action item into the member's own task (source fathom). Nothing is created without the tap. */
export async function makeStepTaskAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(formData, "recordingId");
  const itemIndex = Number(str(formData, "itemIndex"));
  const r = await visibleRecording(workspaceId, id, { userId, programTier: v.membership.programTier, role: v.role });
  const item = r?.actionItems[itemIndex];
  if (!r || !item || !Number.isInteger(itemIndex)) redirect("/recordings");
  const existing = await db.query.recordingSteps.findFirst({ where: and(eq(schema.recordingSteps.recordingId, r!.id), eq(schema.recordingSteps.userId, userId), eq(schema.recordingSteps.itemIndex, itemIndex)) });
  if (existing?.taskId) redirect(`/recordings/${id}#steps`);
  const taskId = newId();
  await db.insert(schema.tasks).values({
    id: taskId,
    workspaceId,
    userId,
    title: item!.description,
    // The moment in the call goes with the task (rev 619), when it has one.
    details: [`From the recording "${shownTitle(r!)}"`, (() => { const m = itemMoment(item!, r!.shareUrl || r!.url); return m ? `Jump to this moment: ${m.href}` : ""; })()].filter(Boolean).join("\n"),
    urgency: "medium",
    category: "system",
    dueDate: v.today,
    status: "today",
    points: taskPoints("medium"),
    source: TASK_SOURCES.fathom,
    sourceRef: r!.id,
  });
  if (existing) await db.update(schema.recordingSteps).set({ state: "accepted", taskId }).where(eq(schema.recordingSteps.id, existing.id));
  else await db.insert(schema.recordingSteps).values({ id: newId(), workspaceId, userId, recordingId: r!.id, itemIndex, text: item!.description, assigneeEmail: item!.assigneeEmail, state: "accepted", taskId });
  refresh();
  redirect(`/recordings/${id}?task=1#steps`);
}

/** A suggested step the member lets go: it stays dismissed, never suggested again. */
export async function dismissStepAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const stepId = str(formData, "stepId");
  const s = await db.query.recordingSteps.findFirst({ where: and(eq(schema.recordingSteps.id, stepId), eq(schema.recordingSteps.workspaceId, workspaceId), eq(schema.recordingSteps.userId, userId)) });
  if (!s || s.state !== "suggested") return;
  await db.update(schema.recordingSteps).set({ state: "dismissed" }).where(eq(schema.recordingSteps.id, s.id));
  refresh();
}
