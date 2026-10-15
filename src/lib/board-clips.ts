import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CLIP_FILE } from "@/lib/engine/board-view";

/** The speaking clips in the repo (public/board), by file name: read when a page renders, so a new file is picked up by existing. */
export function councilClipFiles(): string[] {
  const dir = join(process.cwd(), "public", "board");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => CLIP_FILE.test(f)).sort();
}
