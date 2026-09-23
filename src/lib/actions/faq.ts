"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { needsEyes, normaliseCategory, parseKnowledgeBase, type ParsedEntry } from "@/lib/engine/faq";
import { originAfterAccept, originAfterSave, sameText } from "@/lib/engine/provenance";
import { FAQ_SEND_IN_FLIGHT, pushFaq } from "@/lib/community-loyalty";
import { logSync } from "@/lib/integrations";

const BRAIN = "/brain";
const MAX_UPLOAD = 5 * 1024 * 1024;

/** The coach's own entry, or nowhere. */
async function ownEntry(id: string, workspaceId: string, userId: string) {
  return db.query.faqEntries.findFirst({ where: and(eq(schema.faqEntries.id, id), eq(schema.faqEntries.workspaceId, workspaceId), eq(schema.faqEntries.userId, userId)) });
}

/** The text of an uploaded file: .md and .txt as they are, .docx through a reader. A .pdf is not read yet; the coach pastes its text instead. */
async function textOf(file: File): Promise<{ text: string } | { error: string }> {
  if (file.size > MAX_UPLOAD) return { error: "That file is over 5MB. Paste the text instead." };
  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".markdown")) return { text: bytes.toString("utf8") };
  if (name.endsWith(".docx")) {
    const { extractRawText } = await import("mammoth");
    return { text: (await extractRawText({ buffer: bytes })).value };
  }
  if (name.endsWith(".pdf")) return { error: "A PDF isn't read yet. Open it, copy the text, and paste it below." };
  return { error: "Use a .md, .txt or .docx file, or paste the text." };
}

/**
 * Intake, three doors into one parser: an uploaded file, pasted text, or the Knowledge Base Builder output pasted back. The
 * same deterministic parser reads all three; no model. Every entry lands ai_unreviewed with where it came from, and nothing
 * reaches the bot until the Brief approves it. Text with no entries in the template's format is refused with what to paste.
 */
export async function importFaqAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const file = formData.get("file");
  const pasted = str(formData, "text");
  let text = pasted;
  let source: "upload" | "paste" | "template" = pasted ? "template" : "paste";
  let sourceRef: string | null = null;
  if (file instanceof File && file.size > 0) {
    const r = await textOf(file);
    if ("error" in r) redirect(`${BRAIN}?error=${encodeURIComponent(r.error)}`);
    text = r.text;
    source = "upload";
    sourceRef = file.name.slice(0, 200);
  }
  if (!text.trim()) redirect(`${BRAIN}?error=${encodeURIComponent("Choose a file or paste the text first.")}`);
  const kb = parseKnowledgeBase(text);
  if (!kb.entries.length) redirect(`${BRAIN}?error=${encodeURIComponent("No entries found. Paste the Knowledge Base Builder output (each entry starts with \"### Q:\") or a file in that format.")}`);
  const now = nowIso();
  const rows = kb.entries.map((e: ParsedEntry) => ({ id: newId(), workspaceId, userId, question: e.question, alsoAsked: e.alsoAsked, keywords: e.keywords, answer: e.answer, category: normaliseCategory(e.category), origin: "ai_unreviewed" as const, source, sourceRef, timesAsked: null, updatedAt: now }));
  await db.insert(schema.faqEntries).values(rows);
  await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "in", event: "faq.import", payload: { source, sourceRef, entries: rows.length, header: kb.header ? kb.header.slice(0, 120) : null }, status: "received", note: `${rows.length} entries from ${source}` });
  refresh();
  redirect(`${BRAIN}?imported=${rows.length}`);
}

/** Accept exactly one entry. The log holds who, when and which question; the words stay on the row. */
export async function acceptFaqAction(formData: FormData): Promise<void> {
  const { workspaceId, userId, v } = await ctx();
  const e = await ownEntry(str(formData, "id"), workspaceId, userId);
  if (!e) return;
  const next = originAfterAccept(e.origin);
  if (next === e.origin) return;
  await db.update(schema.faqEntries).set({ origin: next ?? "ai_accepted", updatedAt: nowIso() }).where(eq(schema.faqEntries.id, e.id));
  await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: "faq.accept", payload: { entryId: e.id, question: e.question.slice(0, 120), by: v.user.name }, status: "sent", note: `accepted by ${v.user.name}` });
  refresh();
}

/**
 * Accept the entries that need no eyes, all at once. An answer mentioning a price, a guarantee, a result or a number is never
 * in this set: each of those takes its own Accept, on the Brief where it is pinned.
 */
export async function acceptSafeFaqAction(): Promise<void> {
  const { workspaceId, userId, v } = await ctx();
  const rows = await db.query.faqEntries.findMany({ where: and(eq(schema.faqEntries.workspaceId, workspaceId), eq(schema.faqEntries.userId, userId), eq(schema.faqEntries.origin, "ai_unreviewed")) });
  const safe = rows.filter((r) => !needsEyes(r));
  if (!safe.length) return;
  await db.update(schema.faqEntries).set({ origin: "ai_accepted", updatedAt: nowIso() }).where(inArray(schema.faqEntries.id, safe.map((r) => r.id)));
  for (const r of safe) await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: "faq.accept", payload: { entryId: r.id, question: r.question.slice(0, 120), by: v.user.name, bulk: true }, status: "sent", note: `accepted by ${v.user.name} (safe set)` });
  refresh();
}

/** Edit first: the coach's words replace the draft's; a changed text is a review (origin edited), an unchanged save leaves the mark alone. */
export async function updateFaqAction(formData: FormData): Promise<void> {
  const { workspaceId, userId, v } = await ctx();
  const e = await ownEntry(str(formData, "id"), workspaceId, userId);
  if (!e) return;
  const question = str(formData, "question").slice(0, 500);
  const answer = str(formData, "answer").slice(0, 4000);
  const category = normaliseCategory(str(formData, "category")).slice(0, 60);
  const alsoAsked = str(formData, "alsoAsked").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const keywords = str(formData, "keywords").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!question || !answer) return;
  const changed = !sameText(e.question, question) || !sameText(e.answer, answer);
  const origin = originAfterSave(e.origin, `${e.question}\n${e.answer}`, `${question}\n${answer}`) ?? e.origin;
  await db.update(schema.faqEntries).set({ question, answer, category, alsoAsked, keywords, origin, updatedAt: nowIso() }).where(eq(schema.faqEntries.id, e.id));
  if (changed) await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: "faq.edit", payload: { entryId: e.id, question: question.slice(0, 120), by: v.user.name }, status: "sent", note: `edited by ${v.user.name}` });
  refresh();
  redirect(`${BRAIN}#faq-${e.id}`);
}

export async function deleteFaqAction(formData: FormData): Promise<void> {
  const { workspaceId, userId, v } = await ctx();
  const e = await ownEntry(str(formData, "id"), workspaceId, userId);
  if (!e) return;
  await db.delete(schema.faqEntries).where(eq(schema.faqEntries.id, e.id));
  await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: "faq.remove", payload: { entryId: e.id, question: e.question.slice(0, 120), by: v.user.name }, status: "sent", note: `removed by ${v.user.name}` });
  refresh();
  redirect(deletedTo("/brain", "answer"));
}

/** Approve and send to my bot: the approved answers composed and pushed, read back both ways, and the outcome said plainly. */
export async function sendFaqAction(): Promise<void> {
  const { v } = await ctx();
  const out = await pushFaq(v.membership.id, { reason: "brief", sentBy: v.user.name });
  refresh();
  if (out.status === "sent") redirect(`${BRAIN}?sent=1`);
  // A second press that reached the server while the first send was out: that send answers for both.
  if (out.status === "skipped" && out.note === FAQ_SEND_IN_FLIGHT) redirect(BRAIN);
  // A send that did not land says so beside the button, in words (22 Sep: two failed presses showed nothing). Refused before
  // or by the platform, nothing changed on the bot; refused at the read-back, the write may have landed, so it says that.
  const why = out.note.replace(/^Not sent: /, "");
  const line = /^Pushed/.test(out.note) ? `Couldn't confirm the update on your bot. ${why}` : `Couldn't update your bot. Nothing changed there. ${why}`;
  redirect(`${BRAIN}?failed=${encodeURIComponent(line)}`);
}
