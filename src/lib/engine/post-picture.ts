/**
 * Sending the picture with the post (rev 840), the pure rules. A post's picture lives in private storage, so before a channel
 * posts it goes into the member's own GoHighLevel Media Library as a JPEG every platform takes, and the post carries the
 * address GoHighLevel gives back. A channel that should carry a picture and can't is held with the reason, never posted
 * text-only.
 */

/** The channels GoHighLevel posts to that carry the picture: the Page, Instagram feed and Stories, LinkedIn, Threads. */
export const PICTURE_CHANNELS = new Set(["fb_page", "instagram", "stories", "linkedin", "threads"]);

/** The scope the upload needs, by name (it is on the "Copy the list" permissions). */
export const MEDIA_SCOPE = "medias.write";

export const held = (reason: string) => `Picture didn't attach: ${reason}`;

/** What the member does when the token lacks medias.write: the steps, and that nothing went out text-only. */
export const ADD_PERMISSION =
  "Add one permission: medias.write. GoHighLevel can't add a permission to a key you already have, so make a new one: Settings → Private Integrations → Create new integration, tick every item on the list (Copy the list on Settings → Publishing has it), copy the new key and paste it on Settings → Publishing. Then press Retry. Until then this channel waits: nothing posts without its picture.";

/**
 * The JPEG a post sends: within Instagram's frame (4:5 to 1.91:1, the strictest of the platforms) so one copy serves every
 * channel. A made graphic is 4:5 and goes at 1080 × 1350; a taller photo is cropped to 4:5, a wider one to 1.91:1, from the
 * centre; the long side is at most 1440.
 */
export function jpegPlan(w: number, h: number, kind: "graphic" | "photo"): { width: number; height: number } {
  if (kind === "graphic") return { width: 1080, height: 1350 };
  let cw = w;
  let ch = h;
  if (cw / ch < 0.8) ch = Math.round(cw / 0.8);
  else if (cw / ch > 1.91) cw = Math.round(ch * 1.91);
  const scale = Math.min(1, 1440 / Math.max(cw, ch));
  return { width: Math.max(1, Math.round(cw * scale)), height: Math.max(1, Math.round(ch * scale)) };
}

/** Under every platform's limit with room to spare (Instagram's is 8 MB). */
export const MAX_JPEG_BYTES = 7_500_000;
/** A video goes as it is, up to the Social Planner's limit for a file. */
export const MAX_VIDEO_BYTES = 200_000_000;

/**
 * Instagram's refusal, named for what it was (rev 840): no picture, a caption over 2,200 characters, or the picture's size or
 * shape. Null when it is none of those, so the caller keeps GoHighLevel's own sentence.
 */
export function instagramCause(detail: string, o: { caption: string; hasPicture: boolean }): string | null {
  if (!o.hasPicture || /\b(no|missing|requires?|without)\b[^.]{0,30}\b(media|image|photo|picture)\b|\bmedia\b[^.]{0,20}\b(required|empty|should not be empty)\b/i.test(detail)) return "Instagram needs a picture with the post, and none went with it.";
  if (o.caption.length > 2200 || /caption[^.]{0,40}(too long|2,?200|length)/i.test(detail)) return `Instagram takes a caption of 2,200 characters at most; this one is ${o.caption.length.toLocaleString("en-US")}.`;
  if (/aspect|ratio|dimension|resolution|too (large|big|small)|file size|image size|8\s?mb/i.test(detail)) return "Instagram refused the picture's size or shape: it takes 4:5 to 1.91:1, as a JPEG under 8 MB.";
  return null;
}

/** Whether GoHighLevel's refusal was the missing media scope. */
export const mediaScopeMissing = (status: number | undefined, detail: string) => status === 403 && /medias\.write|medias/i.test(detail);
