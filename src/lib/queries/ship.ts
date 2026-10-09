import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { connectionFor } from "@/lib/ghl";
import { nowFor, outcomesFor } from "@/lib/engine/channel-outcome";
import { KEYWORDS_FIELD, parseRouterKeywords } from "@/lib/engine/keyword-fields";
import { clTokenSet } from "@/lib/community-loyalty";
import { shipSteps, type PostFact, type ShipFacts, type ShipStep } from "@/lib/engine/ship";
import { ladderBlockers } from "@/lib/queries/outcomes";
import { activeHandoff, handoffRowFor, rungsSetup } from "@/lib/rung-drip";
import { formatDateTime } from "@/lib/dates";

/**
 * Ship a ladder, the facts (rev 583 #1, commit 3): what the member's GoHighLevel, the two posts, the drip and the bot say
 * right now, read for the member alone, so the card and the press agree on what runs and what is held.
 */
export async function shipFacts(v: Viewer, ladder: schema.Ladder, opts: { keywordBlocked?: string | null } = {}): Promise<{ facts: ShipFacts; steps: ShipStep[]; item: schema.ContentItem | null; variants: schema.ContentVariant[] }> {
  const userId = v.user.id;
  const [blockers, conn, item] = await Promise.all([
    ladderBlockers(ladder),
    connectionFor(userId),
    ladder.contentItemId ? db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, ladder.contentItemId), eq(schema.contentItems.userId, userId)) }) : Promise.resolve(undefined),
  ]);
  const variants = item ? await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, item.id), eq(schema.contentVariants.userId, userId)) }) : [];
  const outcomes = outcomesFor(variants.filter((x) => x.groupId === ""), nowFor(v));
  const post = (channel: "fb_page" | "instagram"): PostFact => {
    const o = outcomes.find((x) => x.channel === channel);
    if (!o) return { state: "none", reason: null };
    if (o.state === "published") return { state: "published", reason: null };
    if (o.state === "failed" || o.state === "unknown") return { state: "failed", reason: o.reason };
    return { state: "sent", reason: null };
  };
  // Ship hands the rungs only to the rungs-only webhook (rev 625), never the old publisher one, which would post again.
  const setup = rungsSetup(v.membership);
  const [handed, lock] = await Promise.all([item ? handoffRowFor(userId, item.id) : Promise.resolve(null), activeHandoff(userId)]);
  const keyword = ladder.keyword && ladder.keyword.toUpperCase() !== "NONE" ? ladder.keyword.toUpperCase() : "";
  const held = parseRouterKeywords(v.membership.clKeywordsHeld[KEYWORDS_FIELD]);
  const facts: ShipFacts = {
    blockers,
    hasGraphic: Boolean(ladder.graphicImageId),
    publicLink: Boolean(ladder.graphicPublicToken),
    ghl: { connected: Boolean(conn), userId: Boolean(conn?.ghlUserId?.trim()), page: Boolean(conn?.mapping.fb_page), instagram: Boolean(conn?.mapping.instagram) },
    posts: { page: post("fb_page"), instagram: post("instagram") },
    drip: { setUp: setup.on, handed: Boolean(handed), locked: lock.active ? formatDateTime(lock.until, v.tz) : null },
    keyword: { set: Boolean(keyword), token: clTokenSet(v.membership), pushed: Boolean(keyword) && held.some((k) => k.keyword === keyword), blocked: opts.keywordBlocked ?? null },
  };
  return { facts, steps: shipSteps(facts), item: item ?? null, variants };
}
