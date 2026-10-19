/**
 * A member's brand kit (rev 568, 6 Oct): one per member, read by (workspace, member) and nowhere by the workspace alone. A
 * member with no row renders in the house starter kit, and the Settings card says so. Which kit a deck renders in is the
 * webinar owner's, never the signed-in person's and never the coach's.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BrandKit } from "@/db/schema";
import { parseSpelling, type Spelling } from "@/lib/engine/spelling";
import { withLeadColour } from "@/lib/engine/subject";

export async function kitFor(workspaceId: string, userId: string): Promise<BrandKit | null> {
  return (await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)) })) ?? null;
}

/**
 * The kit a webinar's deck renders in (H-811 B1): the owner's kit, with the lead colour of the pathway its offer belongs to as
 * the accent, when that pathway has one. Read by the webinar's owner, never the signed-in person.
 */
export async function deckKitFor<K extends { accent: string; bannedColors: string[] }>(w: { workspaceId: string; userId: string; offerId: string | null }, kit: K | null): Promise<K | null> {
  if (!kit || !w.offerId) return kit;
  const offer = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, w.offerId), eq(schema.offers.workspaceId, w.workspaceId), eq(schema.offers.userId, w.userId)), columns: { pathwayId: true } });
  if (!offer?.pathwayId) return kit;
  const pathway = await db.query.pathways.findFirst({ where: and(eq(schema.pathways.id, offer.pathwayId), eq(schema.pathways.workspaceId, w.workspaceId), eq(schema.pathways.userId, w.userId)), columns: { leadColor: true } });
  return withLeadColour(kit, pathway?.leadColor);
}

/** How this member's AI drafts spell (H-811): their kit's setting, American with no kit. One column read. */
export async function spellingFor(workspaceId: string, userId: string): Promise<Spelling> {
  const row = await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)), columns: { spelling: true } });
  return parseSpelling(row?.spelling);
}

/** Every kit in a workspace, keyed by member: the coach's roster reads this once. */
export async function kitsByMember(workspaceId: string): Promise<Map<string, BrandKit>> {
  const rows = await db.query.brandKits.findMany({ where: eq(schema.brandKits.workspaceId, workspaceId) });
  return new Map(rows.map((k) => [k.userId, k]));
}

export type KitStatus = "starter" | "in progress" | "set";
/** Where a member's kit stands (rev 568): no kit of their own, their own but no logo yet, or set with a logo. Pure. */
export function kitStatus(kit: Pick<BrandKit, "logoImageId" | "logoDarkImageId"> | null | undefined): KitStatus {
  if (!kit) return "starter";
  return kit.logoImageId || kit.logoDarkImageId ? "set" : "in progress";
}
export const KIT_STATUS_WORDS: Record<KitStatus, string> = { starter: "starter kit", "in progress": "in progress, no logo yet", set: "set" };
