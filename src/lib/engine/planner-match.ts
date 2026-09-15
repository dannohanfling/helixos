/**
 * Finds the planner's own copy of a post HelixOS sent, when the create call answered 2xx without an id (seen live 15 Sep:
 * two immediate posts, both published within the minute, no id in the body). One matcher, two uses: find the id that was
 * lost, and, before any retry, make sure the post is not created a second time. Pure.
 *
 * A match is the newest post on the same account whose text starts the same way, created (or published, or scheduled) no
 * earlier than a little before the request. A post with no timestamps at all is allowed to match: the account and the text
 * are the strong signals, and the list is bounded to the location.
 */
export const STALE_AFTER_MS = 60 * 60_000;
const ACCEPTED_RECHECK_MS = 20_000;
/**
 * Whether a row is due a readback when a page opens: an accepted row with no id every twenty seconds, any row with an id
 * once an hour, the published ones included (a post can be deleted in the planner after it went out). A row that already
 * reads deleted or failed is not asked again on its own.
 */
export function needsCheck(row: { externalId: string | null; externalStatus: string | null; externalSyncedAt: string | null; status: string }, nowMs: number, staleAfterMs = STALE_AFTER_MS): boolean {
  if (row.status === "draft" || row.status === "skipped") return false;
  const synced = row.externalSyncedAt ? new Date(row.externalSyncedAt).getTime() : 0;
  if (row.externalStatus === "accepted" && !row.externalId) return nowMs - synced > ACCEPTED_RECHECK_MS;
  if (!row.externalId) return false;
  if (row.externalStatus === "deleted" || row.externalStatus === "failed") return false;
  return nowMs - synced > staleAfterMs;
}

export type PlannerPostLike = { id: string; summary: string | null; accountIds: string[]; status?: string | null; createdAt?: string | null; publishedAt?: string | null; scheduleDate?: string | null };

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const PREFIX = 80;
const SLACK_MS = 10 * 60_000;

export function matchPlannerPost(posts: PlannerPostLike[], want: { accountId: string; summary: string; sinceIso: string }): PlannerPostLike | null {
  const prefix = norm(want.summary).slice(0, PREFIX);
  if (!prefix) return null;
  const since = new Date(want.sinceIso).getTime() - SLACK_MS;
  const stamp = (p: PlannerPostLike) => {
    const t = [p.createdAt, p.publishedAt, p.scheduleDate].filter(Boolean).map((x) => new Date(String(x)).getTime()).filter((n) => Number.isFinite(n));
    return t.length ? Math.max(...t) : null;
  };
  const hits = posts.filter((p) => p.accountIds.includes(want.accountId) && norm(p.summary).startsWith(prefix) && p.status !== "deleted").filter((p) => {
    const t = stamp(p);
    return t === null || t >= since;
  });
  if (!hits.length) return null;
  return hits.sort((a, b) => (stamp(b) ?? 0) - (stamp(a) ?? 0))[0];
}
