"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

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
  await db.insert(schema.proofs).values({ id, workspaceId, userId, ...f, shortVersion: autoShort(f), clientRecordId: opt(formData, "clientRecordId") });
  refresh();
  const back = str(formData, "back");
  redirect(back.startsWith("/") ? back : `/proof/${id}`);
}

export async function updateProofAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const f = fields(formData);
  if (!f.name) return;
  await db.update(schema.proofs).set({ ...f, shortVersion: autoShort(f) }).where(and(eq(schema.proofs.id, id), eq(schema.proofs.userId, userId)));
  refresh();
}

export async function deleteProofAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.proofs).where(and(eq(schema.proofs.id, str(formData, "id")), eq(schema.proofs.userId, userId)));
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
