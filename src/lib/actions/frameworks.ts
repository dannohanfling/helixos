"use server";

import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { newId } from "@/lib/ids";
import { draft } from "@/lib/ai";
import { frameworkPost, frameworkReel, frameworkTraining } from "@/lib/engine/frameworks";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { dryRunFrameworks, frameworkBySlug, importFrameworks, setFrameworkStatus, type DryRun, type ImportCounts } from "@/lib/frameworks";

export type ImportState = { dry?: DryRun; saved?: ImportCounts; error?: string } | null;
const MAX = 2_000_000;

/** Coach → Frameworks: a dry run names what would happen; Save does it. The coach's own, never while switched into a client. */
export async function importFrameworksAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const v = await requireCoach();
  if (v.switchedInto) return { error: "Switch back to your own HelixOS to import frameworks." };
  const text = String(formData.get("text") ?? "");
  if (!text.trim()) return { error: "Paste the frameworks, or choose the file." };
  if (text.length > MAX) return { error: "That's too large for one import. Split the file in two." };
  const mode = str(formData, "mode") === "save" ? "save" : "dry";
  if (mode === "dry") return { dry: await dryRunFrameworks(v.workspace.id, text) };
  const saved = await importFrameworks(v.workspace.id, text);
  refresh();
  return { saved };
}

/** Publish or unpublish one framework. A price holds it as a draft, said on the page. */
export async function setFrameworkStatusAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) redirect("/coach/frameworks");
  const status = str(formData, "status") === "published" ? "published" : "draft";
  const r = await setFrameworkStatus(v.workspace.id, str(formData, "id"), status);
  refresh();
  const back = str(formData, "back");
  const to = back.startsWith("/coach/frameworks") ? back : "/coach/frameworks";
  redirect(`${to}${to.includes("?") ? "&" : "?"}${r.ok ? "saved=1" : `error=${encodeURIComponent(r.error)}`}`);
}

/** Turns a framework into a content item (post, reel script, or training outline) and opens it: the principles' pattern. */
export async function frameworkToContentAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const slug = str(formData, "slug");
  const kind = (["post", "reel", "training"] as const).find((k) => k === str(formData, "kind")) ?? "post";
  const useAi = str(formData, "ai") === "1";
  const f = await frameworkBySlug(workspaceId, slug, v.role === "coach" && !v.switchedInto);
  if (!f) return;
  const firstName = v.user.name.split(" ")[0];
  let body = kind === "post" ? frameworkPost(f, firstName) : kind === "reel" ? frameworkReel(f) : frameworkTraining(f);
  let note: string | null = null;
  let origin: "ai_unreviewed" | "rule" = "rule";
  if (useAi) {
    const ai = await draft(
      `You turn a coaching framework into ${kind === "post" ? "a Facebook post" : kind === "reel" ? "a 60-second reel script with timestamps" : "a 10-minute training outline"}. Keep the steps in their order. Never name a price. Return only the ${kind === "post" ? "post" : kind === "reel" ? "script" : "outline"}, no preamble.`,
      `Framework: ${f.name}${f.borrowedFrom ? ` (after ${f.borrowedFrom})` : ""}\nIdea: ${f.idea}\nSteps:\n${f.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nWhen to use it: ${f.whenToUse ?? ""}\nCommon mistakes: ${f.mistakes ?? ""}\nStory: ${f.story ?? ""}\nExact words: ${f.exactWords ?? ""}\nBusiness: ${v.membership.businessName ?? ""}. Promise: ${v.membership.bigPromise ?? ""}\n\nRule-based draft to improve:\n${body}`,
      3000,
      { feature: "principle_content" },
    );
    if (ai) {
      const stripped = stripFabricated(ai);
      body = stripped.text;
      note = stripNote(stripped.removed);
      origin = "ai_unreviewed";
    }
  }
  const id = newId();
  await db.insert(schema.contentItems).values({
    id,
    workspaceId,
    userId,
    title: kind === "post" ? f.name : kind === "reel" ? `Reel: ${f.name}` : `Training: ${f.name}`,
    status: "creating",
    contentType: kind === "post" ? "Belief Shifting Post" : kind === "reel" ? "Short Form Video" : "LIVE Video",
    platform: kind === "reel" ? "IG Reels" : "FB Group",
    hasCta: kind === "post",
    hook: f.idea,
    body,
    origin,
    notes: [`From framework ${f.name}`, note ?? ""].filter(Boolean).join("\n\n"),
  });
  redirect(`/content/${id}`);
}
