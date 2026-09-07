import { TIERS } from "@/lib/engine/tiers";
import { addDays, formatDate } from "@/lib/dates";

/**
 * Earn Your Way: what a reward or prize needs before a client can take it, and what happens to the caps.
 *
 * A claim is an instant unlock. Points come off at once and the client gets the booking link for that specific reward;
 * taking the next step is theirs. So nothing here is claimable without a link, and the caps count across the whole
 * workspace because they protect the coach's calendar, not any one client's allowance.
 */

export type CapPeriod = "Per Month" | "Per Quarter" | "Lifetime (Total)";
export type PerMonthMode = "calendar" | "rolling";

/** Committed in src/data/rewards-config.json. Survives a re-import of rewards.json and prizes.json, which the importer rewrites. */
export type RewardsConfig = {
  /** "calendar": a Per Month cap resets on the 1st. "rolling": it counts the last 30 days. Quarters follow the same choice (90 days). */
  perMonth: PerMonthMode;
  /** Booking link per reward or prize, keyed by its exact name. Empty means "Opening soon": visible, never claimable. */
  bookingLinks: Record<string, string>;
};

export type CatalogueItem = {
  kind: "reward" | "prize";
  order: number;
  name: string;
  description: string;
  /** Points deducted at claim. Prizes are milestones, not purchases: reaching the threshold unlocks them at no cost. */
  cost: number;
  /** Balance needed to claim: the cost for a reward, the threshold for a prize. */
  minPoints: number;
  /** Member tier that must be reached (rewards only). Prize "tiers" are the prize ladder's own labels, not member tiers. */
  tierRequired: string | null;
  unlockType: string;
  category: string | null;
  cap: number | null;
  capPeriod: CapPeriod | null;
  bookingUrl: string | null;
  /** False for behaviour-triggered rewards with no cost and no tier: the engine that fires them is not built yet. */
  earnable: boolean;
};

type RewardRow = { order: number; name: string | null; description: string | null; pointsCost: number | null; tierRequired: string | null; unlockType: string | null; category: string | null; cap: number | null; capPeriod: string | null };
type PrizeRow = { name: string | null; pointsRequired: number; description: string; tier: string | null; status: string | null };

const cleanTier = (t: string | null | undefined) => (t ?? "").replace(/^[^\w]+/, "").trim() || null;
const link = (config: RewardsConfig, name: string) => {
  const url = (config.bookingLinks[name] ?? "").trim();
  return /^https?:\/\//.test(url) ? url : null;
};

export function catalogue(rewards: RewardRow[], prizes: PrizeRow[], config: RewardsConfig): CatalogueItem[] {
  const rewardItems: CatalogueItem[] = rewards
    .filter((r) => r.name)
    .map((r): CatalogueItem => {
      const cost = Number(r.pointsCost ?? 0);
      const tier = cleanTier(r.tierRequired);
      const behaviour = (r.unlockType ?? "") === "Behavior Trigger";
      return {
        kind: "reward",
        order: r.order,
        name: r.name!,
        description: r.description ?? "",
        cost,
        minPoints: cost,
        tierRequired: tier,
        unlockType: r.unlockType ?? "",
        category: r.category,
        cap: r.cap ?? null,
        capPeriod: (r.capPeriod as CapPeriod) || null,
        bookingUrl: link(config, r.name!),
        earnable: !(behaviour && !cost && !tier),
      };
    })
    .sort((a, b) => a.order - b.order);
  const prizeItems: CatalogueItem[] = prizes
    .filter((p) => p.name && (p.status ?? "Active") === "Active")
    .map((p, i): CatalogueItem => ({
      kind: "prize",
      order: i + 1,
      name: p.name!,
      description: p.description,
      cost: 0,
      minPoints: p.pointsRequired,
      tierRequired: null,
      unlockType: "Milestone",
      category: p.tier,
      cap: null,
      capPeriod: "Lifetime (Total)",
      bookingUrl: link(config, p.name!),
      earnable: true,
    }));
  return [...rewardItems, ...prizeItems];
}

/** The window a cap counts over, ending today, and the day it reopens if every spot is taken. Null means uncapped. */
export function periodWindow(period: CapPeriod | null, today: string, mode: PerMonthMode, claimDates: string[] = []): { start: string; reopens: string | null } | null {
  if (!period) return null;
  if (period === "Lifetime (Total)") return { start: "0000-01-01", reopens: null };
  const days = period === "Per Month" ? 30 : 90;
  if (mode === "rolling") {
    const start = addDays(today, -(days - 1));
    const oldest = claimDates.filter((d) => d >= start && d <= today).sort()[0];
    return { start, reopens: oldest ? addDays(oldest, days) : null };
  }
  const [y, m] = today.split("-").map(Number);
  if (period === "Per Month") {
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    return { start: `${today.slice(0, 7)}-01`, reopens: next };
  }
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const nextQ = qStart + 3;
  return { start: `${y}-${String(qStart).padStart(2, "0")}-01`, reopens: nextQ > 12 ? `${y + 1}-01-01` : `${y}-${String(nextQ).padStart(2, "0")}-01` };
}

export type CapStatus = { cap: number | null; taken: number; open: boolean; reopens: string | null; periodWord: string | null };

/** How many of an item's spots are gone across the workspace in the current window. `claimDates` are YYYY-MM-DD, any client. */
export function capStatus(item: Pick<CatalogueItem, "cap" | "capPeriod">, claimDates: string[], today: string, mode: PerMonthMode): CapStatus {
  if (!item.cap) return { cap: null, taken: claimDates.length, open: true, reopens: null, periodWord: null };
  const w = periodWindow(item.capPeriod, today, mode, claimDates);
  const taken = w ? claimDates.filter((d) => d >= w.start && d <= today).length : claimDates.length;
  const periodWord = item.capPeriod === "Per Month" ? (mode === "rolling" ? "in the last 30 days" : "this month") : item.capPeriod === "Per Quarter" ? (mode === "rolling" ? "in the last 90 days" : "this quarter") : null;
  return { cap: item.cap, taken, open: taken < item.cap, reopens: taken < item.cap ? null : (w?.reopens ?? null), periodWord };
}

/** "1 October", the way the coach says it. */
export function reopenText(date: string): string {
  return `${Number(date.slice(8, 10))} ${formatDate(date, { month: "long" })}`;
}

export function tierLevelOf(name: string | null): number {
  if (!name) return 0;
  return TIERS.find((t) => t.name === cleanTier(name))?.level ?? Number.MAX_SAFE_INTEGER;
}

export type Claimability = { ok: true } | { ok: false; reason: "claimed" | "not-earnable" | "opening-soon" | "tier" | "points" | "cap"; message: string };

/**
 * Every rule the server enforces, in the order the client should hear them. The UI shows the same result; the action is
 * the boundary. `claimed` is this client's own claims; `claimDates` is everyone's, for the cap.
 */
export function claimability(item: CatalogueItem, c: { points: number; tierLevel: number; claimed: Set<string>; claimDates: string[]; today: string; mode: PerMonthMode }): Claimability {
  if (c.claimed.has(item.name)) return { ok: false, reason: "claimed", message: "Claimed" };
  if (!item.earnable) return { ok: false, reason: "not-earnable", message: "Earned by doing, not by spending · not live yet" };
  if (!item.bookingUrl) return { ok: false, reason: "opening-soon", message: "Opening soon" };
  if (item.tierRequired && tierLevelOf(item.tierRequired) > c.tierLevel) return { ok: false, reason: "tier", message: `Unlocks at ${item.tierRequired}` };
  if (c.points < item.minPoints) return { ok: false, reason: "points", message: `${(item.minPoints - c.points).toLocaleString()} more points` };
  const cap = capStatus(item, c.claimDates, c.today, c.mode);
  if (!cap.open) {
    const when = cap.reopens ? ` Opens again ${reopenText(cap.reopens)}.` : "";
    return { ok: false, reason: "cap", message: `All ${cap.cap} taken${cap.periodWord ? ` ${cap.periodWord}` : ""}.${when}` };
  }
  return { ok: true };
}

/** One line of what an item asks for, for the catalogue: tier, points, and how many spots. */
export function requirementText(item: CatalogueItem): string {
  const parts: string[] = [];
  if (item.tierRequired) parts.push(`${item.tierRequired}+`);
  if (item.kind === "prize") parts.push(`${item.minPoints.toLocaleString()} pts reached`);
  else if (item.cost) parts.push(`${item.cost.toLocaleString()} pts`);
  if (item.cap && item.capPeriod) parts.push(`${item.cap} ${item.capPeriod === "Per Month" ? "a month" : item.capPeriod === "Per Quarter" ? "a quarter" : "ever"}`);
  return parts.join(" · ");
}
