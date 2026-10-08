import type { Metadata } from "next";
import { getViewer, type Viewer } from "@/lib/auth";

/**
 * A detail page's own <title> (friction walk G8, 7 Oct: every detail page was titled "HelixOS"): the record's name, read for the
 * viewer the page is served to, so no other member's title ever leaks through a tab, and the section's name when the record is
 * not theirs or not there. Never throws: a title is not worth a 500.
 */
export async function ownTitle(load: (v: Viewer) => Promise<string | null | undefined>, fallback: string): Promise<Metadata> {
  try {
    const v = await getViewer();
    const title = v ? (await load(v))?.trim() : null;
    return { title: title ? `${title} · ${fallback}` : fallback };
  } catch {
    return { title: fallback };
  }
}
