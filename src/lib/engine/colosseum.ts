/**
 * The Colosseum (rev 699, the photo arena of rev 720): the rules with no database. The arena is the overhead photo
 * (1680×944); four rings of stands are ellipses in % of the box, front rows first; this week's top three stand still on
 * the sand; everyone else orbits their tier's ring, evenly spread, each ring offset 23°, outer rings slower. The page's
 * numbers are the Rewards ledger's; the ranks are the Rewards tiers. Nothing here invents a member, a point or a win.
 */
import { sceneLookFor, type SceneLook } from "@/lib/engine/board-view";
import { hasBlockedWord, WIN_REFUSED } from "@/lib/engine/word-filter";

export const ARENA = { w: 1680, h: 944 } as const;
/** % of the arena box, front tier first (rev 720's table), the same for both pictures. */
export const RINGS = [
  { cx: 50.65, cy: 53.5, rx: 18.04, ry: 19.6 },
  { cx: 50.89, cy: 50.64, rx: 25.0, ry: 24.15 },
  { cx: 51.01, cy: 47.99, rx: 31.67, ry: 27.33 },
  { cx: 50.89, cy: 45.34, rx: 38.69, ry: 30.51 },
] as const;
/** Where the champions stand on the sand: #1, #2, #3. */
export const CHAMPION_SPOTS = [
  { x: 50.6, y: 53.5 },
  { x: 46.13, y: 57.73 },
  { x: 55.06, y: 57.73 },
] as const;
/** Seconds per lap, front ring to top: outer rings travel slower, like planets. */
export const LAP_SECONDS = [70, 95, 125, 160] as const;
export const RING_OFFSET_DEG = 23;
/** Roughly what fits a ring at desktop width before avatars would shrink under 44px. */
export const RING_CAP = 24;
export const RING_WORDS = ["Front rows: Centurion and above", "Middle: Alchemist and Sentinel", "Upper: Sage", "Top: Artisan and Philosopher"] as const;
/** Which ring a rank sits on. */
export const TIER_RING: Record<string, number> = { Artisan: 3, Philosopher: 3, Sage: 2, Alchemist: 1, Sentinel: 1, Centurion: 0, Oracle: 0, Titan: 0, Olympian: 0 };
export const WIN_KINDS = ["business", "community"] as const;
export type WinKind = (typeof WIN_KINDS)[number];
export const WIN_MAX = 300;
export const TABS = ["arena", "standings", "wins", "challenges", "week"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_WORDS: Record<Tab, string> = { arena: "The Arena", standings: "Standings", wins: "Wins", challenges: "Challenges", week: "My week" };

export type Standing = { userId: string; membershipId: string; name: string; points: number; week: number; tier: string; hidden: boolean; photo: boolean; isYou: boolean; /** The workspace's coach: never blocked, reported only to Support (H-745). */ coach?: boolean; /** Blocked by the viewer: "A member", no photo, the seat kept so the counts add up (H-745). */ veiled?: boolean };

/** Initials from a name: first letters of the first two words, upper case; one word gives its first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** This week's top three by this week's points (ties by all-time points), among members who haven't hidden; nobody with no points this week. */
export function champions(rows: Standing[]): Standing[] {
  return rows
    .filter((r) => !r.hidden && r.week > 0)
    .sort((a, b) => b.week - a.week || b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, 3);
}

export type RingSeat = { seat: Standing; ring: number; index: number; of: number };
/** Everyone else on their tier's ring, top by points when a ring is full, with the rest counted for the "+N more" chip. */
export function seatRings(rows: Standing[], champs: Standing[]): { rings: RingSeat[][]; more: number[] } {
  const champIds = new Set(champs.map((c) => c.userId));
  const byRing: Standing[][] = [[], [], [], []];
  for (const r of rows) {
    if (r.hidden || champIds.has(r.userId)) continue;
    byRing[TIER_RING[r.tier] ?? 3].push(r);
  }
  const rings: RingSeat[][] = [];
  const more: number[] = [];
  byRing.forEach((list, ring) => {
    const sorted = [...list].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const shown = sorted.slice(0, RING_CAP);
    more.push(Math.max(0, sorted.length - RING_CAP));
    rings.push(shown.map((seat, index) => ({ seat, ring, index, of: shown.length })));
  });
  return { rings, more };
}

/** A seat's angle at time t (seconds): evenly spread, the ring's offset, one lap per LAP_SECONDS. At t = 0 nothing has moved. */
export function seatAngle(ring: number, index: number, of: number, t: number): number {
  const base = (2 * Math.PI * index) / Math.max(1, of) + (RING_OFFSET_DEG * Math.PI * ring) / 180;
  return base + (2 * Math.PI * t) / LAP_SECONDS[ring];
}

/** Where a seat is on its ring (% of the box) and how big it looks: 0.82 at the back of the ellipse to 1.05 at the front. */
export function seatPlace(ring: number, angle: number): { x: number; y: number; scale: number } {
  const R = RINGS[ring];
  return { x: R.cx + R.rx * Math.cos(angle), y: R.cy + R.ry * Math.sin(angle), scale: 0.935 + 0.115 * Math.sin(angle) };
}

/** Whether a point (% of the box) lies on a ring's ellipse, within a tolerance in %. */
export function onRing(ring: number, p: { x: number; y: number }, tol = 0.5): boolean {
  const R = RINGS[ring];
  const d = Math.hypot((p.x - R.cx) / R.rx, (p.y - R.cy) / R.ry);
  return Math.abs(d - 1) * Math.min(R.rx, R.ry) <= tol;
}

/** The arena's look: the member's choice, or night from 19:00 to 06:00 in their own time. */
export const arenaLook = (setting: "auto" | "day" | "night", hour: number): SceneLook => sceneLookFor(setting, hour);

/** Standings: all-time points, this week's change, rank as a word; hidden members are out; one tier when filtered. */
export function standings(rows: Standing[], tier: string | null = null): Standing[] {
  return rows.filter((r) => !r.hidden && (!tier || r.tier === tier)).sort((a, b) => b.points - a.points || b.week - a.week || a.name.localeCompare(b.name));
}

/** Mon to Sun points for My week from ledger rows (createdAt ISO) and the week's Monday (YYYY-MM-DD) in the member's zone. */
export function weekByDay(rows: { points: number; day: string }[], monday: string): { day: string; points: number }[] {
  const start = new Date(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    return { day: d, points: rows.filter((r) => r.day === d).reduce((n, r) => n + r.points, 0) };
  });
}

/** A shared win, read from the form: a kind and up to WIN_MAX characters of plain text, or a refusal in plain words. */
export function readWin(kind: unknown, text: unknown): { ok: true; kind: WinKind; text: string } | { ok: false; error: string } {
  const k = String(kind ?? "");
  if (!(WIN_KINDS as readonly string[]).includes(k)) return { ok: false, error: "Say whether it's a business win or a community win." };
  const t = String(text ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return { ok: false, error: "Write the win first." };
  if (t.length > WIN_MAX) return { ok: false, error: `Keep it under ${WIN_MAX} characters.` };
  if (/@|\+?\d[\d\s().-]{8,}\d/.test(t)) return { ok: false, error: "No emails or phone numbers in a win." };
  // The word filter (H-745): a slur or an explicit word and the win isn't saved; the member's text stays in the box to reword.
  if (hasBlockedWord(t)) return { ok: false, error: WIN_REFUSED };
  return { ok: true, kind: k as WinKind, text: t };
}
