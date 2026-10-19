/**
 * The menu's counts (H-844, plan H-858): what the sidebar, the phone's More page and the More tab in the bottom bar all show.
 * Plain data, so a client component and a test can read it.
 */

/** A count per menu href. What's new carries its unseen entries but shows as a dot, never a number. */
export type NavBadges = Record<string, number>;

/** The one item whose count is a dot: What's new. */
export const DOT_ONLY = "/whats-new";

/** The More tab: a number while something is waiting, a plain dot for What's new alone, and its accessible name. */
export type MoreTab = { count: number; text: string; dot: boolean; label: string };

/** A small badge's text: the number up to 9, then "9+" so it fits over an icon. */
export function badgeText(n: number): string {
  return n > 9 ? "9+" : String(Math.max(0, Math.floor(n)));
}

/**
 * The More tab from the counts and the hrefs this person's menu shows: the total of every shown item's count, What's new left
 * out (it is a dot); a count for an item they can't see (a team member's hidden Intentions) never lights the tab.
 */
export function moreTab(badges: NavBadges, shown: Iterable<string>): MoreTab {
  const hrefs = new Set(shown);
  let count = 0;
  for (const [href, n] of Object.entries(badges)) if (href !== DOT_ONLY && hrefs.has(href) && n > 0) count += Math.floor(n);
  const dot = count === 0 && hrefs.has(DOT_ONLY) && (badges[DOT_ONLY] ?? 0) > 0;
  return { count, text: badgeText(count), dot, label: count ? `More, ${count} waiting` : dot ? "More, something new" : "More" };
}
