/**
 * Sending the picture with the post (rev 840), the server side: the post's picture (a made graphic or a photo from Images, or a
 * Proof attachment) is read from private storage, made into a JPEG every platform takes, and put into the member's own
 * GoHighLevel Media Library with their own token. One upload per picture and GoHighLevel account, shared by every channel and
 * retry. Only the member's own pictures, and only into their own account: the lookup is by workspace, member and location.
 */
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { readProofObject } from "@/lib/proof-storage";
import { uploadMedia } from "@/lib/ghl";
import { mediaTypeFor } from "@/lib/engine/ghl-map";
import { ADD_PERMISSION, MAX_JPEG_BYTES, MAX_VIDEO_BYTES, jpegPlan, mediaScopeMissing } from "@/lib/engine/post-picture";

export type Picture = { ok: true; url: string; type: string } | { ok: false; reason: string; permission: boolean };

type Source = { bytes: Buffer; mime: string; kind: "graphic" | "photo" | "video"; name: string };

/** The picture's own bytes: an Images entry ("img:<id>") or a Proof attachment, the member's own, else null. */
async function readSource(m: { workspaceId: string; userId: string }, source: string): Promise<Source | null> {
  // A reel video (Reel to Post, PR B): the member's own, sent as it is.
  if (source.startsWith("vid:")) {
    const vid = await db.query.mediaVideos.findFirst({ where: and(eq(schema.mediaVideos.id, source.slice(4)), eq(schema.mediaVideos.workspaceId, m.workspaceId), eq(schema.mediaVideos.userId, m.userId)) });
    if (!vid) return null;
    const r = await readProofObject(vid.blobUrl);
    if (!r.ok) return null;
    return { bytes: Buffer.from(await r.arrayBuffer()), mime: vid.mime, kind: "video", name: vid.originalFilename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "reel" };
  }
  if (source.startsWith("img:")) {
    const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, source.slice(4)), eq(schema.deckImages.workspaceId, m.workspaceId), eq(schema.deckImages.userId, m.userId)) });
    if (!img || !img.mime.startsWith("image/") || img.mime === "image/svg+xml") return null;
    const r = await readProofObject(img.blobUrl);
    if (!r.ok) return null;
    return { bytes: Buffer.from(await r.arrayBuffer()), mime: img.mime, kind: img.kind === "graphic" ? "graphic" : "photo", name: (img.caption ?? img.kind).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || img.kind };
  }
  const att = await db.query.proofAttachments.findFirst({ where: and(eq(schema.proofAttachments.id, source), eq(schema.proofAttachments.workspaceId, m.workspaceId)) });
  if (!att || att.kind === "document") return null;
  const proof = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, att.proofId), eq(schema.proofs.userId, m.userId), eq(schema.proofs.status, "approved")), columns: { id: true } });
  if (!proof) return null;
  // A HEIC original is sent as its JPEG rendition.
  const r = await readProofObject(att.displayUrl ?? att.blobUrl);
  if (!r.ok) return null;
  return { bytes: Buffer.from(await r.arrayBuffer()), mime: att.displayUrl ? "image/jpeg" : att.mime, kind: att.kind === "video" ? "video" : "photo", name: att.originalFilename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "photo" };
}

/** The picture as one JPEG within Instagram's frame and every platform's size limit; a video as it is. */
async function forSocial(src: Source): Promise<{ bytes: Buffer; type: string; ext: string; width: number | null; height: number | null } | { error: string }> {
  if (src.kind === "video") return src.bytes.length <= MAX_VIDEO_BYTES ? { bytes: src.bytes, type: src.mime, ext: src.mime === "video/quicktime" ? "mov" : "mp4", width: null, height: null } : { error: "the video is larger than GoHighLevel takes" };
  const meta = await sharp(src.bytes).rotate().metadata();
  const w = meta.autoOrient?.width ?? meta.width ?? 0;
  const h = meta.autoOrient?.height ?? meta.height ?? 0;
  if (!w || !h) return { error: "the picture couldn't be read" };
  const plan = jpegPlan(w, h, src.kind);
  let quality = 86;
  let out = await sharp(src.bytes).rotate().resize({ width: plan.width, height: plan.height, fit: "cover", position: "centre" }).flatten({ background: "#000" }).jpeg({ quality, mozjpeg: true }).toBuffer();
  while (out.length > MAX_JPEG_BYTES && quality > 50) {
    quality -= 12;
    out = await sharp(src.bytes).rotate().resize({ width: plan.width, height: plan.height, fit: "cover", position: "centre" }).flatten({ background: "#000" }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  if (out.length > MAX_JPEG_BYTES) return { error: "the picture is too large to send" };
  return { bytes: out, type: "image/jpeg", ext: "jpg", width: plan.width, height: plan.height };
}

/**
 * The address a post carries for its picture: GoHighLevel's own, from the member's Media Library, uploaded once. A missing
 * medias.write says "Add one permission" (and the connection remembers it for the Settings card); anything else says why.
 */
export async function pictureFor(conn: schema.SocialConnection, m: { workspaceId: string; userId: string }, source: string): Promise<Picture> {
  const key = and(eq(schema.ghlMedia.workspaceId, m.workspaceId), eq(schema.ghlMedia.userId, m.userId), eq(schema.ghlMedia.locationId, conn.locationId), eq(schema.ghlMedia.source, source));
  const had = await db.query.ghlMedia.findFirst({ where: key });
  if (had) return { ok: true, url: had.url, type: mediaTypeFor(had.url) };
  const src = await readSource(m, source);
  if (!src) return { ok: false, reason: "the picture isn't in your Images or Proof Bank any more", permission: false };
  const file = await forSocial(src);
  if ("error" in file) return { ok: false, reason: file.error, permission: false };
  const r = await uploadMedia(conn, { bytes: file.bytes, name: `${src.name}.${file.ext}`, type: file.type });
  if (!r.ok) {
    if (mediaScopeMissing(r.status, r.detail ?? "")) {
      await db.update(schema.socialConnections).set({ mediaScopeMissingAt: nowIso() }).where(eq(schema.socialConnections.id, conn.id));
      return { ok: false, reason: ADD_PERMISSION, permission: true };
    }
    return { ok: false, reason: r.status ? `GoHighLevel didn't take the picture (${r.status}).` : r.error, permission: false };
  }
  if (conn.mediaScopeMissingAt) await db.update(schema.socialConnections).set({ mediaScopeMissingAt: null }).where(eq(schema.socialConnections.id, conn.id));
  // Two channels at the same moment: the second finds the first's row.
  await db.insert(schema.ghlMedia).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, locationId: conn.locationId, source, ghlFileId: r.data.fileId, url: r.data.url, width: file.width, height: file.height }).onConflictDoNothing();
  const row = await db.query.ghlMedia.findFirst({ where: key });
  return { ok: true, url: row?.url ?? r.data.url, type: file.type };
}
