/**
 * Media on a composed post, as pure rules. A proof's attachment can be the post's photo or video: the client picks it, nothing
 * attaches on its own. Two rules ride with the pick. One blocks: a file that shows a result is a typed dollar figure in another
 * form, so it carries the ladder's own check (same key, same label, same marker) and scheduling or posting waits until the
 * post says it is illustrative. One warns: an image with no alt text goes out, but the client hears that a screen reader will
 * say nothing about it. The file itself lives in private storage and is read through the signed-in route; it is never a
 * public address, so it is never sent to the Social Planner (that note is here too).
 */

/** The ladder's checklist label for the same rule, verbatim (src/lib/engine/ladder.ts, key "illustrative"). */
export const ILLUSTRATIVE_LABEL = "Dollar figures are real numbers or marked illustrative";
/** The marker the client adds to a post, verbatim. */
export const ILLUSTRATIVE_MARK = "(Illustrative. Your numbers will differ.)";
export const ALT_WARNING = "This image goes out with no alt text. A screen reader will say nothing about it.";
export const PRIVATE_MEDIA_NOTE = "GoHighLevel needs a public address for media. This file lives in private storage: download it and add it in the Social Planner. It is not sent from here.";
export const STORIES_MEDIA_NOTE = "Stories need a photo or video the Social Planner can fetch. This private file does not count for Stories: paste a public address or take Stories off the list.";
export const PRIVATE_URL_REFUSAL = "That address is a private file in HelixOS, which the Social Planner cannot fetch. Pick it from a proof instead, or paste a public address that starts with https://.";
export const NOT_A_URL_REFUSAL = "The photo or video address must be a web address, starting with http:// or https://.";

/**
 * A typed media address is handed to the Social Planner as-is. One of our private routes is refused whatever happens next;
 * "must be a web address" applies when the post is about to go out (`outgoing`), so an old draft with a bare file name can
 * still be saved as a draft and fixed.
 */
export function mediaUrlProblem(url: string, outgoing = true): string | null {
  const u = url.trim();
  if (!u) return null;
  if (/\/api\/proofs\/attachments\//i.test(u)) return PRIVATE_URL_REFUSAL;
  if (outgoing && !/^https?:\/\/[^\s]+$/i.test(u)) return NOT_A_URL_REFUSAL;
  return null;
}

/** An attachment as the composer offers it: what to show, where to read it from, and the two facts the rules turn on. */
export type ComposerMedia = {
  id: string;
  proofId: string;
  proofTitle: string;
  kind: "image" | "video";
  /** proof name · original filename */
  label: string;
  /** The authenticated read route: works for the signed-in client's preview, never for an outside server. */
  url: string;
  downloadUrl: string;
  hasAlt: boolean;
  showsAResult: boolean;
};

/** The route an attachment is read through; a HEIC is shown as its JPEG rendition. */
export function mediaUrlFor(att: { id: string; displayKey: string | null }): string {
  return `/api/proofs/attachments/${att.id}${att.displayKey ? "?display=1" : ""}`;
}
/** The same route, asking the browser to save the original under its own name. */
export function downloadUrlFor(att: { id: string }): string {
  return `/api/proofs/attachments/${att.id}?download=1`;
}

/** Whether the post already carries the word, in any case. */
const marked = (body: string): boolean => /illustrative/i.test(body);

/**
 * The hard block: a picked file that shows a result, on a post that does not say it is illustrative. The same rule as a
 * typed dollar figure, with the checklist's label first and the marker to add second. Every version that goes out is read,
 * not only the source: a channel builder that cuts lines, or a per-channel override, can drop the marker from what posts.
 * Null when nothing blocks.
 */
export function mediaBlock(media: Pick<ComposerMedia, "showsAResult"> | null, bodies: string | string[]): string | null {
  if (!media || !media.showsAResult) return null;
  const all = (Array.isArray(bodies) ? bodies : [bodies]).filter((b) => b.trim());
  if (all.length && all.every(marked)) return null;
  return `${ILLUSTRATIVE_LABEL}\nAn attached file shows a result. Add ${ILLUSTRATIVE_MARK} to the post, in every version that goes out.`;
}

/** The soft warning: an image going out with no alt text. Never blocks; a video has no alt text to miss. */
export function mediaWarning(media: Pick<ComposerMedia, "kind" | "hasAlt"> | null): string | null {
  if (!media || media.kind !== "image" || media.hasAlt) return null;
  return ALT_WARNING;
}
