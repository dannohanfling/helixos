/**
 * What the Social Planner says about the posts HelixOS sent, written onto the rows the outcome rule reads. Three things:
 *   - recordReadback: GET the post, store its status; the platform's error text becomes a client sentence, never stored raw.
 *   - reconcileLostId: a row the planner accepted without an id is found in the planner's own list (same account, same
 *     text, since the request) and gains its id; the same matcher guards a retry against a second copy.
 *   - refreshStale: the rows a page should check when it opens: accepted rows with no id, and any row with an id not read
 *     back for an hour, including the published ones, because a post can be deleted in the planner after it was published.
 *     Bounded per render so a board with many posts stays quick.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso, wallTimeToUtc } from "@/lib/dates";
import { DELETED_IN_PLANNER } from "@/lib/engine/channel-outcome";
import { explainPlatformError } from "@/lib/engine/ghl-errors";
import { platformName } from "@/lib/engine/ghl-map";
import { matchPlannerPost, needsCheck, orderForCheck, reconcileWindow } from "@/lib/engine/planner-match";
import { redactSecrets } from "@/lib/engine/redact";
import type { SocialConnection } from "@/db/schema";
import { connectionFor, getPost, listPostsIn } from "@/lib/ghl";

export async function recordReadback(variant: schema.ContentVariant, conn: SocialConnection): Promise<void> {
  if (!variant.externalId) return;
  const r = await getPost(conn, variant.externalId);
  if (!r.ok) {
    // A 404 on the readback is the planner no longer holding the post: deleted there, said as such.
    const gone = r.status === 404;
    await db.update(schema.contentVariants).set(gone ? { externalStatus: "deleted", externalError: DELETED_IN_PLANNER, externalSyncedAt: nowIso() } : { externalError: r.error, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, variant.id));
    return;
  }
  const published = r.data.status === "published";
  // The postId question (is it the platform's own id, e.g. Facebook's {pageId}_{postId}?) is settled by shape, never by value.
  if (published && variant.externalStatus !== "published") console.info("[ghl] readback shape", JSON.stringify({ channel: variant.channel, status: r.data.status, hasPostId: Boolean(r.data.postId), postIdLooksLikeFacebook: /^\d+_\d+$/.test(r.data.postId ?? ""), postIdSameAsPlannerId: r.data.postId === variant.externalId, hasPublishedAt: Boolean(r.data.publishedAt), keys: Object.keys(r.data).filter((k) => (r.data as Record<string, unknown>)[k] !== null && (r.data as Record<string, unknown>)[k] !== undefined) }));
  if (r.data.error) console.error("[ghl] readback error", JSON.stringify({ variantId: variant.id, postId: variant.externalId, status: r.data.status, error: redactSecrets(String(r.data.error)).slice(0, 300) }));
  const error = r.data.status === "deleted" ? DELETED_IN_PLANNER : explainPlatformError(r.data.error, platformName(variant.channel));
  await db
    .update(schema.contentVariants)
    .set({ externalStatus: r.data.status, externalError: error, externalSyncedAt: nowIso(), ...(published ? { status: "posted", postedAt: variant.postedAt ?? r.data.publishedAt ?? nowIso() } : {}) })
    .where(eq(schema.contentVariants.id, variant.id));
}

/** The id the planner did not return, from its own list. Returns the id when found and stored; null otherwise. */
export async function reconcileLostId(variant: schema.ContentVariant, conn: SocialConnection): Promise<string | null> {
  const accountId = conn.mapping[variant.channel];
  if (!accountId) return null;
  // The planner is asked for this account inside the request's window, so the answer does not depend on how it orders a
  // list longer than one page; a window it says holds more than one page is refused as unresolvable, not guessed at.
  const tz = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, variant.userId) }))?.timezone;
  const win = reconcileWindow(variant, nowIso(), variant.postAt ? wallTimeToUtc(variant.postAt, tz || "UTC") : null);
  const r = await listPostsIn(conn, { accountId, fromIso: win.fromIso, toIso: win.toIso, limit: 100 });
  if (!r.ok || (r.data.total !== null && r.data.total > r.data.posts.length)) {
    await db.update(schema.contentVariants).set({ externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, variant.id));
    return null;
  }
  const hit = matchPlannerPost(r.data.posts, { accountId, summary: variant.body, sinceIso: win.sinceIso });
  if (!hit) {
    await db.update(schema.contentVariants).set({ externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, variant.id));
    return null;
  }
  const published = hit.status === "published";
  await db
    .update(schema.contentVariants)
    .set({ externalId: hit.id, externalStatus: hit.status ?? "in_progress", externalError: null, externalSyncedAt: nowIso(), ...(published ? { status: "posted", postedAt: variant.postedAt ?? hit.publishedAt ?? nowIso() } : {}) })
    .where(eq(schema.contentVariants.id, variant.id));
  return hit.id;
}

/** Reads back the rows that are due, at most `max` calls, and returns the rows with what was learned. */
export async function refreshStale(userId: string, rows: schema.ContentVariant[], max = 8): Promise<schema.ContentVariant[]> {
  const nowMs = Date.now();
  const due = orderForCheck(rows.filter((r) => needsCheck(r, nowMs))).slice(0, max);
  if (!due.length) return rows;
  const conn = await connectionFor(userId);
  if (!conn) return rows;
  const touched = new Set<string>();
  for (const r of due) {
    if (r.externalStatus === "accepted" && !r.externalId) await reconcileLostId(r, conn);
    else await recordReadback(r, conn);
    touched.add(r.id);
  }
  const fresh = await db.query.contentVariants.findMany({ where: eq(schema.contentVariants.userId, userId) });
  const byId = new Map(fresh.map((x) => [x.id, x]));
  return rows.map((r) => (touched.has(r.id) ? (byId.get(r.id) ?? r) : r));
}
