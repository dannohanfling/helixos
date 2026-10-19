/**
 * The living scenes' reads (H-327 PR A): which rank-up is due on this open and whether its relic clip exists, and the evening
 * close's scene for the close just written. The clips are picked up by file: `public/ranks/rank-{slug}.mp4|.webm` with
 * `rank-{slug}-end.jpg` as the poster and the reduced-motion still; a rank with no clip plays the struck gold medal instead.
 * Nothing here writes; the ceremony's one write (the rank seen) is markTierCelebratedAction, when the member closes it. The
 * catch-up (H-934) reads when the member reached their rank; its write is markRankClipSeenAction, also on close.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { catchUpCard, catchUpFor, closeSceneFor, rankCard, rankUpFor, type CloseScene, type RankCard, type RankClip } from "@/lib/engine/scenes";
import type { WorkDays } from "@/lib/engine/streak";
import { tierFor } from "@/lib/engine/tiers";

export type RankUpShell = { card: RankCard; clip: RankClip | null; stampOnly: false } | { card: null; clip: null; stampOnly: true; level: number };

const RANKS_DIR = path.join(process.cwd(), "public", "ranks");
/** The clip files for a rank, if any exist in public/ranks. Two cheap stats per open that has a rank-up due, never cached, so a clip dropped in by a deploy is picked up at once. */
export function rankClip(slug: string): RankClip | null {
  const has = (f: string) => existsSync(path.join(RANKS_DIR, f));
  const mp4 = has(`rank-${slug}.mp4`) ? `/ranks/rank-${slug}.mp4` : null;
  const webm = has(`rank-${slug}.webm`) ? `/ranks/rank-${slug}.webm` : null;
  if (!mp4 && !webm) return null;
  return { mp4, webm, poster: has(`rank-${slug}-end.jpg`) ? `/ranks/rank-${slug}-end.jpg` : null };
}

/**
 * The rank-up for this open: the card and its clip, a silent stamp for a member whose celebrated rank was never recorded, or
 * null. Never for a coach, never while a coach is switched into a client, never for a team member.
 */
export function rankUpShell(v: Viewer, points: number): RankUpShell | null {
  if (v.role !== "client" || v.switchedInto || v.team) return null;
  const celebrated = v.membership.celebratedTierLevel;
  const tier = rankUpFor(points, celebrated);
  if (tier) return { card: rankCard(tier, points), clip: rankClip(tier.name.toLowerCase()), stampOnly: false };
  if (celebrated === null) return { card: null, clip: null, stampOnly: true, level: tierFor(points).level };
  return null;
}

export type CatchUpShell = { kind: "play"; card: RankCard; clip: RankClip } | { kind: "stamp"; level: number };

/** When the member's running total first reached `min` points: the ledger in time order (its rows hold two text forms of a time, so julianday reads both), the first row the sum gets there. */
async function reachedAt(workspaceId: string, userId: string, min: number): Promise<string | null> {
  const rows = await db.all<{ at: string }>(sql`
    SELECT at FROM (
      SELECT ${schema.pointsLedger.createdAt} AS at,
             julianday(${schema.pointsLedger.createdAt}) AS jd,
             SUM(${schema.pointsLedger.points}) OVER (ORDER BY julianday(${schema.pointsLedger.createdAt}), ${schema.pointsLedger.id} ROWS UNBOUNDED PRECEDING) AS run
      FROM ${schema.pointsLedger}
      WHERE ${schema.pointsLedger.workspaceId} = ${workspaceId} AND ${schema.pointsLedger.userId} = ${userId}
    ) WHERE run >= ${min} ORDER BY jd LIMIT 1`);
  return rows[0]?.at ?? null;
}

/**
 * The catch-up ceremony for this open (H-934, plan H-942), asked only when no rank-up is due: the current rank's relic clip,
 * once, for a member who reached it before the clips went live; a silent stamp for one who reached it after. Never for a
 * coach, while switched in, or for a team member; never when the rank has no clip.
 */
export async function catchUpShell(v: Viewer, points: number, stamping = false): Promise<CatchUpShell | null> {
  if (v.role !== "client" || v.switchedInto || v.team) return null;
  const m = v.membership;
  const t = tierFor(points);
  // A rank never recorded is stamped silently on this same open: the catch-up reads it as already celebrated, so a member who
  // reached it before the clips gets their clip on this first open, not the next one.
  const celebrated = stamping ? t.level : m.celebratedTierLevel;
  // Cheap first: nothing to read for an Artisan or once the current rank's clip is seen.
  if (celebrated === null || t.level <= 1 || (m.rankClipSeenLevel ?? 0) >= t.level) return null;
  const due = catchUpFor({ points, celebrated, clipSeen: m.rankClipSeenLevel, reachedAt: await reachedAt(v.workspace.id, v.user.id, t.minPoints) });
  if (!due) return null;
  if (due.kind === "stamp") return due;
  const clip = rankClip(due.tier.name.toLowerCase());
  if (!clip) return null;
  return { kind: "play", card: catchUpCard(due.tier, points), clip };
}

/** The evening close's scene: the close row the ledger holds for the card's day, within the window. */
export async function closeSceneShell(v: Viewer, a: { day: string; closed: boolean; streak: number; ladder: Set<string>; days: WorkDays }): Promise<CloseScene | null> {
  if (!a.closed || v.switchedInto || v.team) return null;
  const row = await db.query.pointsLedger.findFirst({
    where: and(eq(schema.pointsLedger.workspaceId, v.workspace.id), eq(schema.pointsLedger.userId, v.user.id), eq(schema.pointsLedger.type, "close"), eq(schema.pointsLedger.refId, a.day)),
    columns: { id: true, points: true, createdAt: true },
  });
  return closeSceneFor({ row: row ?? null, now: Date.now(), day: a.day, streak: a.streak, days: a.days, ladder: a.ladder });
}
