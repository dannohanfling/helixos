import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { isVerified, sharedAsEvidence } from "@/lib/engine/evidence";

/** A study a prompt or a picker may cite: the client's own verified ones and the shared shelf they have not removed. */
export type Citable = { id: string; source: "own" | "shared"; name: string; claim: string; authors: string; year: number | null; title: string; url: string | null; doi: string | null; citedByCount: number };

/** The client's shelf: their own rows (newest first), the shared shelf minus what they removed, and how many they removed. Once per request. */
export const evidenceShelf = cache(async (userId: string) => {
  const [own, shared, hidden] = await Promise.all([
    db.query.evidence.findMany({ where: eq(schema.evidence.userId, userId), orderBy: desc(schema.evidence.createdAt) }),
    db.query.evidenceShared.findMany(),
    db.query.evidenceHidden.findMany({ where: eq(schema.evidenceHidden.userId, userId) }),
  ]);
  const hiddenIds = new Set(hidden.map((h) => h.sharedId));
  return { own, shared: shared.filter((s) => !hiddenIds.has(s.id)), removed: shared.filter((s) => hiddenIds.has(s.id)) };
});

/** Only what is citable: nothing unverified ever reaches a prompt or an insert. */
export async function citableEvidence(userId: string): Promise<Citable[]> {
  const { own, shared } = await evidenceShelf(userId);
  return [
    ...own.filter(isVerified).map((e) => ({ id: e.id, source: "own" as const, name: e.claim, claim: e.claim, authors: e.authors, year: e.year, title: e.title, url: e.url, doi: e.doi, citedByCount: e.citedByCount })),
    ...shared.map((s) => ({ id: s.id, source: "shared" as const, ...sharedAsEvidence(s) })),
  ];
}

export async function ownEvidence(userId: string, id: string) {
  return db.query.evidence.findFirst({ where: and(eq(schema.evidence.id, id), eq(schema.evidence.userId, userId)) });
}
