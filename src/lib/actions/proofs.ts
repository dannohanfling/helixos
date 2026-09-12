"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { isTrim } from "@/lib/engine/fathom";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { attachmentsBlockApproval } from "@/lib/engine/proof-attachments";
import { attachmentsFor, deleteAttachmentsForProof } from "@/lib/queries/proof-attachments";
import { redactUrls } from "@/lib/engine/storage-policy";

const BELIEFS = ["vehicle", "internal", "external", "none"] as const;

function fields(fd: FormData) {
  return {
    name: str(fd, "name"),
    type: PROOF_TYPES.find((t) => t === str(fd, "type")) ?? "result",
    who: opt(fd, "who"),
    problemBefore: opt(fd, "problemBefore"),
    shift: opt(fd, "shift"),
    resultAfter: opt(fd, "resultAfter"),
    beliefBroken: BELIEFS.find((b) => b === str(fd, "beliefBroken")) ?? "none",
    shortVersion: opt(fd, "shortVersion"),
    longVersion: opt(fd, "longVersion"),
    hook: opt(fd, "hook"),
    punchline: opt(fd, "punchline"),
    link: opt(fd, "link"),
    status: str(fd, "status") === "approved" ? ("approved" as const) : ("draft" as const),
  };
}

/** One-line proof, built from the parts when no short version was written. */
function autoShort(f: ReturnType<typeof fields>): string | null {
  if (f.shortVersion) return f.shortVersion;
  const who = f.who ?? "A client";
  if (f.resultAfter && f.problemBefore) return `${who} went from "${f.problemBefore.replace(/[.]$/, "")}" to ${f.resultAfter.replace(/[.]$/, "")}.`;
  if (f.resultAfter) return `${who}: ${f.resultAfter}`;
  return null;
}

export async function createProofAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const f = fields(formData);
  if (!f.name) return;
  const id = newId();
  // Every proof starts as a draft; approval goes through the permission tick, harvested or typed.
  await db.insert(schema.proofs).values({ id, workspaceId, userId, ...f, status: "draft", shortVersion: autoShort(f), clientRecordId: opt(formData, "clientRecordId") });
  refresh();
  const back = str(formData, "back");
  redirect(back.startsWith("/") ? back : `/proof/${id}`);
}

/** The versions of a harvested quote that must each be a trim of it. Hook and punchline are frame: how the proof is deployed, in the client's own words. */
const SHAPES = ["shortVersion", "longVersion"] as const;

export async function updateProofAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const f = fields(formData);
  if (!f.name) return;
  const existing = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, userId)) });
  if (!existing) return;
  // Status never moves through this form, harvested or typed: approval is the permission tick, and back to draft is its own button.
  const { status: _status, ...rest } = f;
  void _status;
  if (existing.quote) {
    // Harvested from a recording: the words are someone else's. Short and long are trims of the verbatim quote or they are refused.
    for (const k of SHAPES) {
      const value = f[k];
      if (value && !isTrim(value, existing.quote)) redirect(`/proof/${id}?notVerbatim=${k}`);
    }
    // The name may be corrected (an email to a name, say) only while it is a draft; once approved the attribution is fixed.
    const who = existing.status === "approved" ? existing.who : (f.who ?? existing.who);
    await db.update(schema.proofs).set({ ...rest, who, shortVersion: f.shortVersion ?? existing.shortVersion }).where(eq(schema.proofs.id, id));
  } else {
    await db.update(schema.proofs).set({ ...rest, shortVersion: autoShort(f) }).where(eq(schema.proofs.id, id));
  }
  refresh();
  redirect(`/proof/${id}`); // a clean URL: an earlier "not a trim" notice must not outlive the save that fixed it
}

/** Tick two, for every proof, harvested or typed. "[Name] has given me permission to use what they said here in my marketing." No tick, no approval; one proof at a time. */
export async function approveProofAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, userId)) });
  if (!p) return;
  if (formData.get("permission") !== "on") redirect(`/proof/${id}?needsPermission=1`);
  // The same gate, extended: an attachment that shows a person needs their likeness permission recorded before the proof can be approved.
  const held = attachmentsBlockApproval(await attachmentsFor(id));
  if (held) redirect(`/proof/${id}?needsAttachmentConsent=1`);
  await db.update(schema.proofs).set({ status: "approved", permissionAt: nowIso(), permissionBy: userId }).where(eq(schema.proofs.id, id));
  refresh();
  redirect(`/proof/${id}`);
}

/** Back to draft: the safe direction never needs a tick. The record of the earlier tick is kept. */
export async function unapproveProofAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.update(schema.proofs).set({ status: "draft" }).where(and(eq(schema.proofs.id, str(formData, "id")), eq(schema.proofs.userId, userId)));
  refresh();
}

/** Deletion actually deletes: every attachment's object leaves the store before the proof row goes. A refused object delete keeps the proof and says so. */
export async function deleteProofAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId)) });
  if (!p) return;
  try {
    await deleteAttachmentsForProof(p.id, p.workspaceId);
  } catch (e) {
    console.error("[proof-storage] delete refused while deleting a proof; the proof stays", redactUrls(JSON.stringify({ proofId: p.id, message: e instanceof Error ? e.message : String(e) })));
    redirect(`/proof/${p.id}?error=proofDeleteRefused`);
  }
  await db.delete(schema.proofs).where(eq(schema.proofs.id, p.id));
  refresh();
  redirect("/proof");
}

/** A client's win from a check-in becomes a proof draft in one click. */
export async function proofFromCheckinAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const checkinId = str(formData, "checkinId");
  const k = await db.query.clientCheckins.findFirst({ where: and(eq(schema.clientCheckins.id, checkinId), eq(schema.clientCheckins.userId, userId)) });
  if (!k?.wins) return;
  const c = await db.query.clientRecords.findFirst({ where: eq(schema.clientRecords.id, k.clientRecordId) });
  const id = newId();
  const who = c ? c.name.split(" ")[0] : "A client";
  await db.insert(schema.proofs).values({
    id,
    workspaceId,
    userId,
    name: `${who}: ${k.wins.split(/[.!]/)[0].slice(0, 60)}`,
    type: "result",
    who,
    problemBefore: c?.roadblock ?? c?.fear ?? null,
    resultAfter: k.wins,
    shortVersion: `${who}: ${k.wins}`,
    clientRecordId: k.clientRecordId,
    status: "draft",
  });
  refresh();
  redirect(`/proof/${id}`);
}

/** Drafts a Client Win post from a proof. */
export async function proofToContentAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, str(formData, "id")), eq(schema.proofs.userId, userId)) });
  if (!p) return;
  const id = newId();
  const body = [
    p.hook ?? `${p.who ?? "Someone in my program"} just did something worth telling you about.`,
    "",
    p.problemBefore ? `Before: ${p.problemBefore}` : "",
    p.shift ? `What changed: ${p.shift}` : "",
    p.resultAfter ? `Now: ${p.resultAfter}` : "",
    "",
    p.punchline ?? (p.beliefBroken !== "none" ? "The plan did the work. They just followed it." : ""),
    "",
    "If that's the kind of result you want, comment \"me\" and I'll send you what they did first.",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
  await db.insert(schema.contentItems).values({ id, workspaceId, userId, title: `Win: ${p.name}`, status: "creating", contentType: "Client Win", platform: "FB Group", hasCta: true, hook: p.hook ?? p.shortVersion ?? p.name, body, notes: `From proof ${p.id}` });
  redirect(`/content/${id}`);
}
