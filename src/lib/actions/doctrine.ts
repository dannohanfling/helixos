"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { VOICE, draft } from "@/lib/ai";
import { principlePost, principleReel, principleTraining } from "@/lib/engine/doctrine";
import { ctx, str } from "./common";

/** Turns a principle into a content item (post, reel script, or training outline) and opens it. */
export async function principleToContentAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const code = str(formData, "code");
  const kind = (["post", "reel", "training"] as const).find((k) => k === str(formData, "kind")) ?? "post";
  const useAi = str(formData, "ai") === "1";
  const p = await db.query.principles.findFirst({ where: eq(schema.principles.code, code) });
  if (!p) return;
  const firstName = v.user.name.split(" ")[0];
  let body = kind === "post" ? principlePost(p, firstName) : kind === "reel" ? principleReel(p) : principleTraining(p);
  if (useAi) {
    const ai = await draft(
      `You turn a business principle into ${kind === "post" ? "a Facebook post" : kind === "reel" ? "a 60-second reel script with timestamps" : "a 10-minute training outline"}. ${VOICE} Return only the ${kind === "post" ? "post" : kind === "reel" ? "script" : "outline"}, no preamble.`,
      `Principle: ${p.symbol ?? ""} ${p.greekName ?? ""} ${p.name}\nDoctrine: ${p.doctrine ?? p.summary ?? ""}\nStories to draw from:\n${[p.publicFigureStory, p.businessCase, p.greekStory, p.clientStory].filter(Boolean).join("\n\n---\n\n").slice(0, 6000)}\nBusiness: ${v.membership.businessName ?? ""}. Promise: ${v.membership.bigPromise ?? ""}\n\nRule-based draft to improve:\n${body}`,
      3000,
    );
    if (ai) body = ai;
  }
  const id = newId();
  await db.insert(schema.contentItems).values({
    id,
    workspaceId,
    userId,
    title: kind === "post" ? p.name : kind === "reel" ? `Reel: ${p.name}` : `Training: ${p.name}`,
    status: "creating",
    contentType: kind === "post" ? "Belief Shifting Post" : kind === "reel" ? "Short Form Video" : "LIVE Video",
    platform: kind === "reel" ? "IG Reels" : "FB Group",
    hasCta: kind === "post",
    hook: p.hookAngle ?? p.name,
    body,
    notes: `From principle ${p.code}`,
  });
  redirect(`/content/${id}`);
}
