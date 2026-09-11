"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { MAGNET_PRIMARY, MAGNET_TYPES, type MagnetFormats, type MagnetType } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { MAGNET_TYPE_INFO, keywordOf, parseContent, parseGenerated, scaffoldContent, slugify } from "@/lib/engine/lead-magnet";
import { evidenceLines } from "@/lib/engine/evidence";
import { citableEvidence } from "@/lib/queries/evidence";
import { deleteObject, putPublicMagnet } from "@/lib/storage";
import { renderMagnetPdf } from "@/lib/pdf";

const typeOf = (raw: string): MagnetType => (MAGNET_TYPES as readonly string[]).includes(raw) ? (raw as MagnetType) : "checklist";

async function own(id: string, userId: string) {
  const m = await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, id), eq(schema.leadMagnets.userId, userId)) });
  if (!m) redirect("/magnets");
  return m;
}

/** Two magnets in one workspace never share a keyword: a comment could not be routed. Returns the clash, if any. */
async function keywordClash(workspaceId: string, keyword: string, exceptId?: string) {
  const where = exceptId ? and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.keyword, keyword), ne(schema.leadMagnets.id, exceptId)) : and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.keyword, keyword));
  return db.query.leadMagnets.findFirst({ where });
}
const clashMessage = (keyword: string, title: string) => `The keyword ${keyword} is already on "${title}". Two magnets in one workspace can't share one.`;

/** The public address, from the title only: never an id, never a person's name or email. A taken slug gets a number. */
async function freeSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let n = 0; n < 50; n++) {
    const slug = n ? `${base}-${n + 1}` : base;
    if (!(await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.slug, slug) }))) return slug;
  }
  return `${base}-${newId().slice(0, 6).toLowerCase()}`;
}

const formatsOf = (fd: FormData): MagnetFormats => ({ page: fd.get("f_page") === "on", pdf: fd.get("f_pdf") === "on", copy: fd.get("f_copy") === "on", canva: fd.get("f_canva") === "on" });
const questionsOf = (fd: FormData): string[] =>
  str(fd, "chatbotQuestions")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);

/** Type first, then the promise: a new magnet starts as the type's shape with the promise as its intro, nothing invented. */
export async function createMagnetAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const title = str(formData, "title");
  if (!title) return;
  const type = typeOf(str(formData, "type"));
  const promise = str(formData, "promise");
  const keyword = keywordOf(str(formData, "keyword") || title.split(/\s+/)[0]);
  if (!keyword) redirect(`/magnets?error=${encodeURIComponent("A keyword needs at least one letter or digit.")}`);
  const clash = await keywordClash(workspaceId, keyword);
  if (clash) redirect(`/magnets?error=${encodeURIComponent(clashMessage(keyword, clash.title))}`);
  const id = newId();
  await db.insert(schema.leadMagnets).values({ id, workspaceId, userId, title, promise, audience: str(formData, "audience"), offerId: opt(formData, "offerId"), type, keyword, slug: await freeSlug(title), content: scaffoldContent(type, promise), generatedBy: "scaffold" });
  refresh();
  redirect(`/magnets/${id}`);
}

export async function updateMagnetAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  const keyword = keywordOf(str(formData, "keyword")) || m.keyword;
  const clash = await keywordClash(workspaceId, keyword, m.id);
  if (clash) redirect(`/magnets/${m.id}?error=${encodeURIComponent(clashMessage(keyword, clash.title))}`);
  const formats = formatsOf(formData);
  const primary = MAGNET_PRIMARY.find((p) => p === str(formData, "primary")) ?? m.primary;
  await db
    .update(schema.leadMagnets)
    .set({
      title: str(formData, "title") || m.title,
      promise: str(formData, "promise"),
      audience: str(formData, "audience"),
      offerId: opt(formData, "offerId"),
      type: typeOf(str(formData, "type")),
      keyword,
      content: parseContent(str(formData, "content")),
      formats,
      primary,
      personalReply: opt(formData, "personalReply"),
      personalDm: opt(formData, "personalDm"),
      chatbotAnswer: opt(formData, "chatbotAnswer"),
      chatbotDelivery: opt(formData, "chatbotDelivery"),
      chatbotQuestions: questionsOf(formData),
      notes: opt(formData, "notes"),
      updatedAt: nowIso(),
    })
    .where(eq(schema.leadMagnets.id, m.id));
  refresh();
  redirect(`/magnets/${m.id}?saved=1`);
}

/**
 * ✨ Writes the magnet from what is already true: the Big Promise, the audience, the offer, approved proof (verbatim) and
 * confirmed evidence (claim and citation together). Anything the model adds that the blacklist knows comes out of every
 * string, and the notes say what went. No key, or an answer outside the shape: the type's scaffold, and the notes say so.
 */
export async function generateMagnetAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  const [membership, offer, proofs, citable] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }),
    m.offerId ? db.query.offers.findFirst({ where: and(eq(schema.offers.id, m.offerId), eq(schema.offers.userId, userId)) }) : Promise.resolve(null),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) }),
    citableEvidence(userId),
  ]);
  const info = MAGNET_TYPE_INFO[m.type];
  const evidence = evidenceLines(citable);
  const task = `You write a lead magnet for a coach: the thing a reader comments a keyword to receive. Type: ${info.label}. ${info.shape} Write it as the coach, for their audience, from the facts given and nothing else. Output only a JSON object with keys "intro", "sections" (an array of objects with "heading", "items" (an array of strings)${m.type === "guide" ? ', "why", "how"' : ""}), "closing", "personalReply" (the public comment reply the coach posts under a comment on their personal profile), "personalDm" (the message the coach sends by hand with the link), "chatbotAnswer" (what an automated reply on the business page says when someone comments the keyword), "chatbotDelivery" (the message that carries the link) and "chatbotQuestions" (up to five questions the automation asks, an array of strings). Proof may be used only verbatim as given. Studies may be cited only from the list given, claim and citation together. No other statistics, studies or results. Where a fact is missing, leave it out rather than invent it. The keyword is never in the intro or the sections.`;
  const input = [
    `TITLE: ${m.title}`,
    `PROMISE: ${m.promise || "(not set)"}`,
    `AUDIENCE: ${m.audience || "(not set)"}`,
    `KEYWORD (for the hand-over messages only): ${m.keyword}`,
    `BIG PROMISE: ${membership?.bigPromise ?? "(not set)"}`,
    membership?.businessName ? `BUSINESS: ${membership.businessName}` : "",
    offer ? `OFFER: ${offer.name}. Core problem: ${offer.coreProblem ?? "(not set)"}. Promise: ${offer.promise ?? "(not set)"}. Mechanism: ${offer.mechanismName ?? "(not set)"}.` : "OFFER: none linked.",
    proofs.length ? `APPROVED PROOF (verbatim only, first name and last initial):\n${proofs.map((p) => `- ${p.who ?? p.name}: "${(p.shortVersion ?? p.resultAfter ?? "").replace(/^"|"$/g, "")}"`).join("\n")}` : "APPROVED PROOF: none. Use no testimonial.",
    evidence.length ? `CONFIRMED EVIDENCE (the only studies that may be cited):\n${evidence.join("\n")}` : "CONFIRMED EVIDENCE: none. Cite no study.",
    m.content.sections.some((s) => s.items.length) ? `CURRENT DRAFT (keep what works):\n${JSON.stringify(m.content)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const text = await draft(task, input, 6000, { feature: "lead_magnet" });
  const g = text ? parseGenerated(text) : null;
  if (g) {
    await db
      .update(schema.leadMagnets)
      .set({ content: g.content, personalReply: g.personalReply || m.personalReply, personalDm: g.personalDm || m.personalDm, chatbotAnswer: g.chatbotAnswer || m.chatbotAnswer, chatbotDelivery: g.chatbotDelivery || m.chatbotDelivery, chatbotQuestions: g.chatbotQuestions.length ? g.chatbotQuestions : m.chatbotQuestions, generatedBy: "claude", notes: [m.notes, g.note].filter(Boolean).join("\n") || null, updatedAt: nowIso() })
      .where(eq(schema.leadMagnets.id, m.id));
  } else {
    await db
      .update(schema.leadMagnets)
      .set({ content: scaffoldContent(m.type, m.promise), generatedBy: text ? "claude-partial" : "scaffold", notes: [m.notes, text ? `Claude did not return the magnet's shape. Its answer:\n${text.slice(0, 2000)}` : null].filter(Boolean).join("\n") || null, updatedAt: nowIso() })
      .where(eq(schema.leadMagnets.id, m.id));
  }
  refresh();
  redirect(`/magnets/${m.id}${g?.note ? "?stripped=1" : ""}`);
}

/** The typeset PDF, written to the public magnets prefix by the one writer that marks an object public. The old one is removed. */
export async function buildMagnetPdfAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  const [membership, user] = await Promise.all([db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }), db.query.users.findFirst({ where: eq(schema.users.id, userId) })]);
  const bytes = await renderMagnetPdf({ title: m.title, promise: m.promise, audience: m.audience, content: m.content, type: m.type, byline: membership?.businessName ?? user?.name ?? "" });
  const stored = await putPublicMagnet(workspaceId, m.slug, `${m.slug}.pdf`, bytes, "application/pdf");
  if (m.pdfKey) await deleteObject(m.pdfKey);
  await db.update(schema.leadMagnets).set({ pdfKey: stored.key, formats: { ...m.formats, pdf: true }, updatedAt: nowIso() }).where(eq(schema.leadMagnets.id, m.id));
  refresh();
  redirect(`/magnets/${m.id}?pdf=1`);
}

const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"];
/** Under Vercel's request body cap for a serverless function, which is where a server action's upload lands. */
const UPLOAD_MAX = 4 * 1024 * 1024;

/** A file made elsewhere (Canva, a designer), served at its own public URL. Same writer, same prefix. */
export async function uploadMagnetFileAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) redirect(`/magnets/${m.id}?error=${encodeURIComponent("Choose a file first.")}`);
  if (file.size > UPLOAD_MAX) redirect(`/magnets/${m.id}?error=${encodeURIComponent("That file is over 4 MB. Export it smaller, or link to it from the page instead.")}`);
  if (!UPLOAD_TYPES.includes(file.type)) redirect(`/magnets/${m.id}?error=${encodeURIComponent("That file type can't be served. PDF, PNG, JPEG, plain text, Word or ZIP.")}`);
  const stored = await putPublicMagnet(workspaceId, m.slug, file.name, Buffer.from(await file.arrayBuffer()), file.type);
  if (m.fileKey) await deleteObject(m.fileKey);
  await db.update(schema.leadMagnets).set({ fileKey: stored.key, fileName: file.name, updatedAt: nowIso() }).where(eq(schema.leadMagnets.id, m.id));
  refresh();
  redirect(`/magnets/${m.id}?uploaded=1`);
}

export async function removeMagnetFileAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  if (m.fileKey) await deleteObject(m.fileKey);
  await db.update(schema.leadMagnets).set({ fileKey: null, fileName: null, primary: m.primary === "file" ? "page" : m.primary, updatedAt: nowIso() }).where(eq(schema.leadMagnets.id, m.id));
  refresh();
}

export async function deleteMagnetAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const m = await own(str(formData, "id"), userId);
  for (const key of [m.pdfKey, m.fileKey]) if (key) await deleteObject(key);
  await db.update(schema.ladders).set({ leadMagnetId: null }).where(eq(schema.ladders.leadMagnetId, m.id));
  await db.delete(schema.leadMagnets).where(eq(schema.leadMagnets.id, m.id));
  refresh();
  redirect("/magnets");
}
