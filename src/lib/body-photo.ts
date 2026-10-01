/**
 * The meal photo's one AI call (rev 237 phase 14). This is the only HumanOS module that talks to src/lib/ai.ts, and it reads no
 * HumanOS table: the caller (the action) checks the member's AI switch and passes the image alone, so no HumanOS data goes to
 * the model from here (rev 219's rule: that path is bodyAiContext only). The photo is never stored or logged.
 */
import { AiImageError, aiStatus, draft } from "@/lib/ai";
import type { Viewer } from "@/lib/auth";
import type { DraftImage } from "@/lib/engine/ai-request";
import { PHOTO_TASK, PHOTO_USER, parsePhotoLines, type PhotoLine } from "@/lib/engine/body-photo";

export type PlateRead = { lines: PhotoLine[]; note: string | null } | { problem: "model" | "no_answer" | "nothing" };

/** The plate, read by the member's own model with the task alone: no Essence, feature meal_photo. */
export async function readPlate(image: DraftImage): Promise<PlateRead> {
  let text: string | null;
  try {
    text = await draft(PHOTO_TASK, PHOTO_USER, 1200, { feature: "meal_photo", essence: false, images: [image] });
  } catch (e) {
    if (e instanceof AiImageError) return { problem: "model" };
    throw e;
  }
  if (!text) return { problem: "no_answer" };
  const { lines, note } = parsePhotoLines(text);
  return lines.length ? { lines, note } : { problem: "nothing" };
}

/** Whether the Log page can offer the photo: a working key under today's cap. The member's AI switch is the page's own check. */
export async function photoReady(v: Viewer): Promise<boolean> {
  const s = await aiStatus(v);
  return s.hasKey && !s.blocked;
}
