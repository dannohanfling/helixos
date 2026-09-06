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

export function tierFor(points: number): Tier {
  let current = TIERS[0];
  for (const t of TIERS) if (points >= t.minPoints) current = t;
  return current;
}

export function nextTier(points: number): Tier | null {
  const current = tierFor(points);
  return TIERS.find((t) => t.level === current.level + 1) ?? null;
}

export function tierProgress(points: number): { current: Tier; next: Tier | null; pct: number; toNext: number } {
  const current = tierFor(points);
  const next = nextTier(points);
  if (!next) return { current, next, pct: 100, toNext: 0 };
  const span = next.minPoints - current.minPoints;
  const into = points - current.minPoints;
  return { current, next, pct: Math.max(0, Math.min(100, Math.round((into / span) * 100))), toNext: next.minPoints - points };
}
