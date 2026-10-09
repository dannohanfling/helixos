import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GraphicOptions, Ladder } from "@/db/schema";
import { newId } from "@/lib/ids";
import { deckImageKey } from "@/lib/engine/deck-image";
import { backgroundPrompt, canGenerateBackground, graphicCaption, photoChoices, pickPhoto, type PhotoCandidate } from "@/lib/engine/graphic";
import { kitFor } from "@/lib/queries/brand-kit";
import { putDeckObject, readProofObject } from "@/lib/proof-storage";
import { renderGraphic } from "@/lib/graphic-render";
import { credentialFor, generateImage } from "@/lib/ai";
import { memberHeadshotBytes } from "@/lib/headshots";

/**
 * Make the graphic, the stored side (rev 513, amended by 514 and 524): the member's own photos to choose from, the render
 * from their own kit and photo, one PNG master kept in the private store as an Images entry of kind graphic (the headline as
 * its caption) and on the ladder, and an AI background made with their own key when the kit allows it. Everything is read
 * and written for the member alone.
 */
export type Member = { workspaceId: string; userId: string };
const mineImg = (m: Member) => and(eq(schema.deckImages.workspaceId, m.workspaceId), eq(schema.deckImages.userId, m.userId));

/** The member's own picture, or null. */
export async function ownImage(m: Member, id: string | null | undefined) {
  if (!id) return null;
  return (await db.query.deckImages.findFirst({ where: and(mineImg(m), eq(schema.deckImages.id, id)) })) ?? null;
}
/** The bytes of one of the member's own pictures, from the private store; null when it is gone. */
export async function imageBytes(m: Member, id: string | null | undefined): Promise<Buffer | null> {
  const img = await ownImage(m, id);
  if (!img) return null;
  const res = await readProofObject(img.blobUrl);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** What the step shows: the photos to pick from (the suggestion first), the kit's badge, and whether a background can be made. */
export async function graphicStep(m: Member, headline: string) {
  const [images, kit, cred] = await Promise.all([db.query.deckImages.findMany({ where: mineImg(m), orderBy: (t, { desc }) => [desc(t.createdAt)] }), kitFor(m.workspaceId, m.userId), credentialFor(m.workspaceId, m.userId)]);
  const candidates: PhotoCandidate[] = images.map((i) => ({ id: i.id, kind: i.kind, caption: i.caption, width: i.width, height: i.height, createdAt: i.createdAt, source: i.source }));
  const choices = photoChoices(headline, candidates);
  return {
    choices,
    suggestedId: pickPhoto(headline, candidates)?.id ?? null,
    kit,
    aiAllowed: kit?.aiBackgrounds ?? true,
    canGenerate: canGenerateBackground(cred?.provider) && !cred?.lastError,
    aiNote: (cred ? (cred.provider === "anthropic" ? "anthropic" : cred.lastError ? "broken" : null) : "none") as "none" | "anthropic" | "broken" | null,
  };
}

export type MakeResult = { ok: true; imageId: string } | { ok: false; error: string };
/**
 * Renders and stores the ladder's graphic: the photo (the member's own, or none), the headline chosen, the kit's badge and
 * gold. The master is one PNG in the member's own deck folder of the private store, an Images row of kind graphic (source
 * render), and the ladder points at it; the previous graphic stays in Images (rev 514).
 */
export async function makeGraphic(m: Member, ladder: Ladder, options: GraphicOptions): Promise<MakeResult> {
  const kit = await kitFor(m.workspaceId, m.userId);
  const photo = await imageBytes(m, options.photoImageId);
  if (options.photoImageId && !photo) return { ok: false, error: "That photo isn't in your Images any more. Pick another." };
  // The badge: the avatar the member picked, else their profile photo when they said yes to it (client headshots, rule 6).
  const avatar = (await imageBytes(m, kit?.graphicAvatarImageId)) ?? (kit?.graphicUseHeadshot ? await memberHeadshotBytes(m.workspaceId, m.userId) : null);
  let master: Buffer;
  try {
    master = await renderGraphic({ headline: options.headline, photo, strongFade: options.strongFade, badge: { avatar, name: kit?.graphicDisplayName?.trim() || "", handle: kit?.graphicHandle?.trim() || "", verified: kit?.graphicVerified ?? false }, gold: { from: kit?.graphicGoldFrom, to: kit?.graphicGoldTo } });
  } catch (e) {
    console.error("[graphic] render failed", JSON.stringify({ ladderId: ladder.id, message: e instanceof Error ? e.message.slice(0, 300) : String(e) }));
    return { ok: false, error: "The graphic couldn't be drawn just now. Try again in a minute." };
  }
  const id = newId();
  let object: { key: string; url: string };
  try {
    object = await putDeckObject(deckImageKey(m.workspaceId, m.userId, id, "png"), master, "image/png");
  } catch (e) {
    console.error("[graphic] store failed", JSON.stringify({ ladderId: ladder.id, message: e instanceof Error ? e.message.slice(0, 300) : String(e) }));
    return { ok: false, error: "The graphic was drawn but couldn't be saved. Try again in a minute." };
  }
  const { MASTER_WIDTH, MASTER_HEIGHT } = await import("@/lib/engine/graphic");
  await db.insert(schema.deckImages).values({ id, workspaceId: m.workspaceId, userId: m.userId, kind: "graphic", blobKey: object.key, blobUrl: object.url, mime: "image/png", width: MASTER_WIDTH, height: MASTER_HEIGHT, caption: graphicCaption(options.headline), source: "render" });
  await db.update(schema.ladders).set({ graphicImageId: id, graphicOptions: options }).where(and(eq(schema.ladders.id, ladder.id), eq(schema.ladders.userId, m.userId)));
  return { ok: true, imageId: id };
}

/**
 * An AI background (rev 524): a scene from the headline's words, made with the member's own OpenAI key, kept as one of their
 * photos (source ai, captioned as such) so the picker offers it and Images says what it is. Refused when the kit says no.
 */
export async function generateBackground(m: Member, ladder: Pick<Ladder, "headline" | "topic">): Promise<{ ok: true; imageId: string } | { ok: false; error: string }> {
  const kit = await kitFor(m.workspaceId, m.userId);
  if (kit && !kit.aiBackgrounds) return { ok: false, error: "AI backgrounds are off in your Brand kit. Turn them on there, or pick one of your own photos." };
  const r = await generateImage(backgroundPrompt(ladder.headline, ladder.topic));
  if ("error" in r) return { ok: false, error: r.error };
  const id = newId();
  let object: { key: string; url: string };
  try {
    object = await putDeckObject(deckImageKey(m.workspaceId, m.userId, id, "png"), r.bytes, "image/png");
  } catch {
    return { ok: false, error: "The background was made but couldn't be saved. Try again in a minute." };
  }
  await db.insert(schema.deckImages).values({ id, workspaceId: m.workspaceId, userId: m.userId, kind: "photo", blobKey: object.key, blobUrl: object.url, mime: "image/png", width: 1024, height: 1536, caption: `AI background: ${graphicCaption(ladder.headline) || ladder.topic}`.slice(0, 200), source: "ai" });
  return { ok: true, imageId: id };
}
