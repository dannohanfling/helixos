/**
 * Reel to Post, PR B (H-1948, plan H-1953): a member's reel video, attached to a post. The browser uploads it straight into
 * the private store on a token this app issues (src/app/api/reel-videos/upload); this file records it only after reading the
 * object back from the store and sniffing its first bytes, reads it for the member and for posting, and removes it. A video is
 * the member's own: every lookup is by workspace and member.
 */
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { deleteProofObject, headProofObject, readProofObject } from "@/lib/proof-storage";
import { REEL_VIDEO_MAX_BYTES, reelVideoKeyOwner, sniffReelVideo } from "@/lib/engine/reel-listen";
import { redactUrls } from "@/lib/engine/storage-policy";

/** How many reel videos a member keeps at once: twenty at the 200 MB cap is 4 GB, the most one member's posts should hold. */
export const REEL_VIDEOS_PER_MEMBER = 20;
export const TOO_MANY_VIDEOS = `You have ${REEL_VIDEOS_PER_MEMBER} reel videos kept already. Remove the video from an older reel post first, or create this post without attaching the video.`;
const TRANSIENT = "The video uploaded but couldn't be checked just now. Press Create post again in a minute.";

const log = (what: string, detail: Record<string, unknown>) => console.error(`[reel-videos] ${what}`, redactUrls(JSON.stringify(detail)));

/** Room for one more: the count of the member's kept videos, before the upload token is issued and again when it is recorded. */
export async function videoRoom(workspaceId: string, userId: string): Promise<string | null> {
  const [{ n }] = await db.select({ n: count() }).from(schema.mediaVideos).where(and(eq(schema.mediaVideos.workspaceId, workspaceId), eq(schema.mediaVideos.userId, userId)));
  return n >= REEL_VIDEOS_PER_MEMBER ? TOO_MANY_VIDEOS : null;
}

async function discard(url: string, why: string) {
  try {
    await deleteProofObject(url);
  } catch (e) {
    log("could not discard a refused upload", { why, message: e instanceof Error ? e.message : String(e) });
  }
}

export type RecordVideo = { ok: true; id: string } | { ok: false; error: string };

/**
 * Records an uploaded reel video: the key is under the member's own folder, the store's size is under the cap, the first
 * bytes are an MP4 or QuickTime file. Anything else is removed from the store and refused. Recording the same key twice
 * gives the same answer.
 */
export async function recordReelVideo(m: { workspaceId: string; userId: string }, input: { key: string; seconds: number | null; filename: string }): Promise<RecordVideo> {
  const owner = reelVideoKeyOwner(input.key);
  if (!owner || owner.workspaceId !== m.workspaceId || owner.userId !== m.userId) return { ok: false, error: "That video isn't under your own folder. Choose it again and press Create post." };
  const already = await db.query.mediaVideos.findFirst({ where: eq(schema.mediaVideos.blobKey, input.key) });
  if (already) return already.userId === m.userId ? { ok: true, id: already.id } : { ok: false, error: "That video isn't yours." };
  let object: { url: string; size: number };
  try {
    object = await headProofObject(input.key);
  } catch (e) {
    log("could not read an uploaded video back", { message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: TRANSIENT };
  }
  if (object.size > REEL_VIDEO_MAX_BYTES) {
    await discard(object.url, "over the cap");
    return { ok: false, error: `That video is over ${REEL_VIDEO_MAX_BYTES / 1_000_000} MB, the most a post can carry. Create the post without attaching it.` };
  }
  const head = await readProofObject(object.url, "bytes=0-63");
  if (!(head.ok || head.status === 206)) {
    log("the store refused the sniff read", { status: head.status });
    return { ok: false, error: TRANSIENT };
  }
  const sniffed = sniffReelVideo(new Uint8Array(await head.arrayBuffer()));
  if (!sniffed) {
    await discard(object.url, "not a video");
    return { ok: false, error: "That file isn't an MP4 or MOV video. Create the post without attaching it, or choose the video file itself." };
  }
  const full = await videoRoom(m.workspaceId, m.userId);
  if (full) {
    await discard(object.url, "too many videos");
    return { ok: false, error: full };
  }
  const id = owner.videoId;
  const seconds = input.seconds !== null && Number.isFinite(input.seconds) && input.seconds > 0 ? Math.round(input.seconds) : null;
  await db.insert(schema.mediaVideos).values({ id, workspaceId: m.workspaceId, userId: m.userId, blobKey: input.key, blobUrl: object.url, mime: sniffed.mime, bytes: object.size, seconds, originalFilename: input.filename.slice(0, 200) || `reel.${sniffed.ext}` });
  return { ok: true, id };
}

/** The member's own video, or null. */
export async function ownVideo(m: { workspaceId: string; userId: string }, id: string) {
  return (await db.query.mediaVideos.findFirst({ where: and(eq(schema.mediaVideos.id, id), eq(schema.mediaVideos.workspaceId, m.workspaceId), eq(schema.mediaVideos.userId, m.userId)) })) ?? null;
}

/**
 * Removes a video: the stored file first, then the row, and every post and ladder stops pointing at it. When the store
 * refuses, the row stays, so the member never loses sight of a file that is still kept.
 */
export async function removeReelVideo(m: { workspaceId: string; userId: string }, id: string): Promise<boolean> {
  const v = await ownVideo(m, id);
  if (!v) return false;
  try {
    await deleteProofObject(v.blobUrl);
  } catch (e) {
    log("the store refused a delete; the row is kept", { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
  await db.update(schema.ladders).set({ videoId: null }).where(and(eq(schema.ladders.userId, m.userId), eq(schema.ladders.videoId, id)));
  await db.update(schema.contentItems).set({ mediaAttachmentId: null }).where(and(eq(schema.contentItems.workspaceId, m.workspaceId), eq(schema.contentItems.mediaAttachmentId, `vid:${id}`)));
  await db.delete(schema.mediaVideos).where(eq(schema.mediaVideos.id, id));
  return true;
}

/** Whether any post still carries the video; a ladder deleted on its own keeps a video a post still uses. */
export async function videoInUse(workspaceId: string, id: string): Promise<boolean> {
  return Boolean(await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.workspaceId, workspaceId), eq(schema.contentItems.mediaAttachmentId, `vid:${id}`)), columns: { id: true } }));
}

/** A fresh id and key for an upload about to start. */
export const newVideoId = (): string => newId();
