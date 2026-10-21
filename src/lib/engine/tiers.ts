import tiersJson from "@/data/seed/tiers.json";

export type Tier = {
  level: number;
  name: string;
  minPoints: number;
  maxPoints: number | null;
  color: string;
  welcome: string | null;
  signal: string | null;
};

export const TIERS: Tier[] = (tiersJson as Tier[]).slice().sort((a, b) => a.level - b.level);

export const TIER_ICONS: Record<string, string> = {
  Artisan: "🔨",
  Philosopher: "🏛️",
  Sage: "📜",
  Alchemist: "⚗️",
  Sentinel: "🛡️",
  Centurion: "⚔️",
  Oracle: "🔮",
  Titan: "🏔️",
  Olympian: "⚡",
};

/** The rank the points alone earn under the current table. Most callers want `keptTier`, which never drops a rank. */
export function tierFor(points: number): Tier {
  let current = TIERS[0];
  for (const t of TIERS) if (points >= t.minPoints) current = t;
  return current;
}

/**
 * A member's rank (H-1088): the higher of the rank they keep (the highest they have ever held, backfilled from the old
 * thresholds) and the rank their points earn now. Nobody ever drops a rank when the thresholds change.
 */
export function keptTier(points: number, keptLevel: number | null | undefined): Tier {
  const earned = tierFor(points);
  if (!keptLevel || keptLevel <= earned.level) return earned;
  return TIERS.find((t) => t.level === keptLevel) ?? earned;
}

/** The rank of a membership row: `keptTier` with its kept level. */
export function rankOf(m: { rankKeptLevel: number | null }, points: number): Tier {
  return keptTier(points, m.rankKeptLevel);
}

export function nextTier(points: number, keptLevel?: number | null): Tier | null {
  const current = keptTier(points, keptLevel);
  return TIERS.find((t) => t.level === current.level + 1) ?? null;
}

/**
 * Where a member stands: their rank (kept), the next one and how far to it. A kept rank above what the points earn starts its
 * bar at the points themselves, so the bar never runs backwards: "8,800 to Centurion" from 3,200 for a kept Sentinel.
 */
export function tierProgress(points: number, keptLevel?: number | null): { current: Tier; next: Tier | null; pct: number; toNext: number } {
  const current = keptTier(points, keptLevel);
  const next = TIERS.find((t) => t.level === current.level + 1) ?? null;
  if (!next) return { current, next, pct: 100, toNext: 0 };
  const from = Math.min(current.minPoints, points);
  const span = next.minPoints - from;
  const into = points - from;
  return { current, next, pct: span > 0 ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 0, toNext: Math.max(0, next.minPoints - points) };
}
