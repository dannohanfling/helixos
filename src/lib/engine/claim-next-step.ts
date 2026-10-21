/**
 * Who acts next on a claimed reward (H-1586, plan H-1588 approved in H-1594). A reward with a booking link is the
 * member's to book; one without a link is delivered by the coach by hand, and the member's row says so until the coach
 * marks it done. The pure words, shared by the claim action, the Rewards page and Coach.
 */

/** The two 30-day access rewards: the coach opens the member's month by hand. */
export function isAccessReward(name: string): boolean {
  return /^30 Days Access to /.test(name);
}

/** The words after a granted claim: the booking link only when there is one, otherwise who acts next. */
export function claimToast(cost: number, hasLink: boolean): string {
  const spent = cost ? `Claimed. ${cost.toLocaleString()} points spent.` : "Claimed.";
  return hasLink ? `${spent} Your booking link is ready.` : `${spent} Your coach delivers this one and it shows Done here.`;
}

/** The status on the member's row for an open claim with no link. */
export const WAITING_ON_COACH = "Waiting on your coach";

/** The plain line under that row: what happens next, and where it shows. */
export function waitingLine(name: string): string {
  return isAccessReward(name)
    ? "Your coach opens your 30 days by hand. It shows Done ✓ here once it's open."
    : "Your coach delivers this by hand. It shows Done ✓ here once it's done.";
}

/** The coach's own words on an open claim with no link. */
export const COACH_DELIVERS = "you deliver this by hand";

/** A claim with no link left open longer than this gets the line at the top of Coach. */
export const WAITING_TOO_LONG_MS = 24 * 60 * 60 * 1000;

/** Open claims with no link, older than a day, at `now`. createdAt is stored as SQLite UTC ("YYYY-MM-DD HH:MM:SS") or ISO. */
export function overdueNoLinkClaims(claims: { rewardName: string; createdAt: string }[], linkOf: (name: string) => string | null | undefined, now: Date): number {
  return claims.filter((c) => {
    if (linkOf(c.rewardName)) return false;
    const at = Date.parse(c.createdAt.includes("T") ? c.createdAt : c.createdAt.replace(" ", "T") + "Z");
    return Number.isFinite(at) && now.getTime() - at > WAITING_TOO_LONG_MS;
  }).length;
}
