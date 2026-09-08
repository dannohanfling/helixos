"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { seal } from "@/lib/crypto";
import { draft, hasAiKey } from "@/lib/ai";
import { fathomConnectionFor, fathomKeyFor, readTranscript, validateFathomKey } from "@/lib/fathom";
import { attribution, autoTrim, deepLink, parseExtraction, transcriptText, verify } from "@/lib/engine/fathom";
import { ctx, refresh, str } from "@/lib/action-helpers";

/** Saves the member's own Fathom key after a real check. Tick one (the acknowledgement) is required the first time and dated on the membership. */
export async function saveFathomKeyAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const key = str(formData, "fathomKey");
  const ticked = formData.get("consent") === "on";
  if (!v.membership.fathomConsentAt && !ticked) redirect("/settings?fathom=consent#fathom");
  if (!key) redirect("/settings?fathom=nokey#fathom");
  const r = await validateFathomKey(userId, key);
  const row = { keyEncrypted: seal(key)!, last4: key.slice(-4), lastValidatedAt: r.ok ? nowIso() : null, lastError: r.ok ? null : r.error };
  const existing = await fathomConnectionFor(workspaceId, userId);
  if (existing) await db.update(schema.fathomConnections).set(row).where(eq(schema.fathomConnections.id, existing.id));
  else await db.insert(schema.fathomConnections).values({ id: newId(), workspaceId, userId, ...row });
  if (!v.membership.fathomConsentAt && ticked) await db.update(schema.memberships).set({ fathomConsentAt: nowIso() }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  redirect("/settings#fathom");
}

export async function recheckFathomKeyAction(): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const existing = await fathomConnectionFor(workspaceId, userId);
  if (!existing) return;
  const { open } = await import("@/lib/crypto");
  const key = open(existing.keyEncrypted);
  if (!key) {
    await db.update(schema.fathomConnections).set({ lastError: "The stored key can't be read any more. Paste it again." }).where(eq(schema.fathomConnections.id, existing.id));
  } else {
    const r = await validateFathomKey(userId, key);
    await db.update(schema.fathomConnections).set(r.ok ? { lastError: null, lastValidatedAt: nowIso() } : { lastError: r.error }).where(eq(schema.fathomConnections.id, existing.id));
  }
  refresh();
}

export async function removeFathomKeyAction(): Promise<void> {
  const { workspaceId, userId } = await ctx();
  await db.delete(schema.fathomConnections).where(and(eq(schema.fathomConnections.workspaceId, workspaceId), eq(schema.fathomConnections.userId, userId)));
  refresh();
}

/** The transcript as the model sees it is capped; a call longer than this is read up to the cap and the client is told. */
const TRANSCRIPT_CAP = 80000;

/**
 * Reads the one recording the member picked, asks the model for the moments where the member's own client describes a
 * result, and keeps only what the transcript confirms word for word. Everything lands as a draft. Nothing here runs unless a
 * person submitted this form for this recording.
 */
export async function harvestRecordingAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const recordingId = str(formData, "recordingId");
  const title = str(formData, "title") || "Recording";
  const url = str(formData, "url");
  const recordedAt = str(formData, "recordedAt") || null;
  const back = (q: string) => redirect(`/proof/harvest?${q}`);
  if (!recordingId) back("error=norecording");
  const fk = await fathomKeyFor(workspaceId, userId);
  if (!fk) back("error=nokey");
  if (!(await hasAiKey())) back("error=noai");
  const t = await readTranscript(userId, fk!.key, recordingId);
  if (!t.ok) back(`error=${encodeURIComponent(t.error)}`);
  const entries = t.ok ? t.data : [];
  if (!entries.length) back(`error=${encodeURIComponent("That recording has no transcript yet.")}`);
  let text = transcriptText(entries);
  const truncated = text.length > TRANSCRIPT_CAP;
  if (truncated) text = text.slice(0, TRANSCRIPT_CAP);
  const answer = await draft(
    `You find testimonials in a transcript of a coaching call. Return ONLY a JSON object of the shape {"quotes":[{"quote":"...","speaker":"..."}]}. Every "quote" must be copied word for word from the transcript: the exact text of one line, or of consecutive lines by the same speaker, with nothing changed, added, removed, reordered or corrected. Quote only the coach's client (never the coach) describing a result, a change, or their experience. Up to 8 quotes, complete sentences where possible. If there are none, return {"quotes":[]}.`,
    `The coach on this call is ${v.user.name}. Recording: ${title}.\n\nTranscript (each line is [time] speaker: words):\n${text}`,
    4000,
    { feature: "harvest" },
  );
  if (answer === null) back("error=ai");
  const { kept, dropped } = verify(parseExtraction(answer ?? ""), entries);
  const existing = await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), eq(schema.proofs.sourceRecordingId, recordingId)) });
  const have = new Set(existing.map((p) => p.quote ?? ""));
  let found = 0;
  let already = 0;
  for (const q of kept) {
    if (have.has(q.quote)) {
      already++;
      continue;
    }
    const link = url ? deepLink(url, q.timestamp) : null;
    await db.insert(schema.proofs).values({
      id: newId(),
      workspaceId,
      userId,
      name: `${attribution(q.speaker)}: ${autoTrim(q.quote, 8)}`,
      type: "testimonial",
      who: q.speaker,
      quote: q.quote,
      longVersion: q.quote,
      shortVersion: autoTrim(q.quote),
      link,
      sourceRecordingId: recordingId,
      sourceUrl: link,
      sourceTimestamp: q.timestamp,
      sourceRecordedAt: recordedAt,
      contextBefore: q.contextBefore,
      contextAfter: q.contextAfter,
      status: "draft",
    });
    found++;
  }
  refresh();
  back(`recording=${encodeURIComponent(recordingId)}&found=${found}&dropped=${dropped}&already=${already}${truncated ? "&truncated=1" : ""}`);
}
