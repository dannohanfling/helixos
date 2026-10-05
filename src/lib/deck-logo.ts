/**
 * The deck's logos, server side (first-deck brief §3): the one the export and the Deck step's thumbnails both use, so the two
 * cannot disagree. The logo is the kit's pick, else the newest logo in the owner's own library (a client's deck, their logo);
 * the dark one is the kit's "Logo for dark backgrounds" alone. Which goes on the cover, and on a badge or bare, is the engine's
 * call (coverLogoPlan); this reads the rows and, only when the engine needs it, the one logo's bytes to measure its colour.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DeckImage } from "@/db/schema";
import { coverLogoPlan } from "@/lib/engine/deck";
import { normaliseHex } from "@/lib/engine/subject";
import { logoColor } from "@/lib/deck-media";
import { readProofObject } from "@/lib/proof-storage";

export type DeckLogos = { logo: DeckImage | null; dark: DeckImage | null; cover: DeckImage | null; badge: string | null };

/** The private object's bytes, or null when they can't be read. */
export async function readDeckBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await readProofObject(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deckLogos(
  owner: { workspaceId: string; userId: string },
  kit: { logoImageId?: string | null; logoDarkImageId?: string | null } | null,
  cover: { background: string; ground: string },
  read: (url: string) => Promise<Buffer | null> = readDeckBytes,
): Promise<DeckLogos> {
  const inWorkspace = (id: string) => db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, owner.workspaceId)) });
  const logo =
    (kit?.logoImageId ? await inWorkspace(kit.logoImageId) : null) ??
    (await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.workspaceId, owner.workspaceId), eq(schema.deckImages.userId, owner.userId), eq(schema.deckImages.kind, "logo")), orderBy: [desc(schema.deckImages.createdAt)] })) ??
    null;
  const dark = (kit?.logoDarkImageId ? await inWorkspace(kit.logoDarkImageId) : null) ?? null;
  // The one logo is measured only when it would stand on a dark cover with no dark logo to take its place.
  const needsMeasure = Boolean(logo && !dark && normaliseHex(cover.background) !== normaliseHex(cover.ground));
  const bytes = needsMeasure ? await read(logo!.blobUrl) : null;
  const plan = coverLogoPlan({ coverBackground: cover.background, ground: cover.ground, hasLogo: Boolean(logo), hasDark: Boolean(dark), logoColor: bytes ? await logoColor(bytes) : null });
  return { logo, dark, cover: plan.use === "dark" ? dark : plan.use === "logo" ? logo : null, badge: plan.badge };
}
