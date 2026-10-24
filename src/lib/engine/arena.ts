/**
 * 30 Days in the Arena (H-1562, plan H-1563, v3 brief H-1575): the pure rules. A member challenge while Danno is in Egypt:
 * 30 days, 27 Nov to 26 Dec in Pacific time; close the day on 24 of them to finish; join by Thu 26 Nov; four live Huddles.
 * The data side is src/lib/arena.ts. Points are never copied: the window's points are read from the ledger as they are.
 */

export const ARENA_SLUG = "30-days-in-the-arena";

export type ArenaConfig = {
  slug: string;
  name: string;
  /** The first and last day that count, as dates in `timezone`. */
  startDate: string;
  endDate: string;
  /** The last day to tap I'm in, in the same zone. */
  joinBy: string;
  timezone: string;
  targetDays: number;
};

/** The challenge as the plan locks it. */
export const ARENA: ArenaConfig = {
  slug: ARENA_SLUG,
  name: "30 Days in the Arena",
  startDate: "2026-11-27",
  endDate: "2026-12-26",
  joinBy: "2026-11-26",
  timezone: "America/Los_Angeles",
  targetDays: 24,
};

/** The window as instants, for the ledger: midnight Pacific (UTC-8 all through it) at both ends. The page's own config. */
export const ARENA_STARTS_AT = "2026-11-27T08:00:00.000Z";
export const ARENA_ENDS_AT = "2026-12-27T07:59:59.999Z";

/** The four live Huddles, Wednesdays at 8 AM Pacific (16:00 UTC), with the page's words for each. */
export const ARENA_HUDDLES: readonly { startsAt: string; label: string }[] = [
  { startsAt: "2026-12-02T16:00:00.000Z", label: "Week one's winner" },
  { startsAt: "2026-12-09T16:00:00.000Z", label: "Halfway check" },
  { startsAt: "2026-12-16T16:00:00.000Z", label: "Push week" },
  { startsAt: "2026-12-23T16:00:00.000Z", label: "The final stretch" },
];

/** The levels the Arena is for (the brief: Accelerator, Academy and Elite; Luxe sits above Elite). Others wait on Danno's word. */
export const ARENA_LEVELS = ["Accelerator", "Academy", "Elite", "Luxe"] as const;

/** Days in a window of two dates, both counted. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export const ARENA_DAYS = daysBetween(ARENA.startDate, ARENA.endDate);

/** The date in a zone for an instant, as YYYY-MM-DD. */
export function dateIn(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export type ArenaPhase = "before" | "open" | "closed";

/** Before the first day, during the 30, or after the last, by the challenge's own zone. */
export function arenaPhase(c: Pick<ArenaConfig, "startDate" | "endDate">, today: string): ArenaPhase {
  if (today < c.startDate) return "before";
  if (today > c.endDate) return "closed";
  return "open";
}

/** Day N of 30 on a date, or null outside the window. */
export function arenaDay(c: Pick<ArenaConfig, "startDate" | "endDate">, today: string): number | null {
  return arenaPhase(c, today) === "open" ? daysBetween(c.startDate, today) : null;
}

/** Joining is open until the end of the join-by day, in the challenge's zone. */
export function joinOpen(c: Pick<ArenaConfig, "joinBy">, today: string): boolean {
  return today <= c.joinBy;
}

/** Who may join: a client at one of the Arena's levels. A coach runs it; a team member is someone else's helper. */
export function canEnter(m: { role: string; programTier: string; team?: boolean }): boolean {
  return m.role === "client" && !m.team && (ARENA_LEVELS as readonly string[]).includes(m.programTier);
}

/** Who sees the page: anyone who may enter, and the coach. */
export function canSee(m: { role: string; programTier: string; team?: boolean }): boolean {
  return !m.team && (m.role === "coach" || canEnter(m));
}

/** The next Huddle that hasn't finished (each runs an hour), or null after the last. */
export function nextHuddle(now: Date, huddles: readonly { startsAt: string; label: string }[] = ARENA_HUDDLES): { startsAt: string; label: string } | null {
  return huddles.find((h) => Date.parse(h.startsAt) + 3_600_000 > now.getTime()) ?? null;
}

/** "Wed 2 Dec, 8 AM Pacific" for a Huddle: the time as the page states it, in Pacific, for everyone. */
export function huddleWhen(startsAt: string): string {
  const at = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: ARENA.timezone, weekday: "short", day: "numeric", month: "short" }).format(at).replace(",", "");
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: ARENA.timezone, hour: "numeric", minute: "2-digit" }).format(at).replace(":00", "");
  return `${day}, ${hour} Pacific`;
}

/** The countdown under the hero (the page's own three states): to the start, to the end, then closed. */
export type Countdown = { state: "before" | "open" | "closed"; days: number; hours: number; minutes: number; label: string };
export function countdown(nowMs: number, startsAt = ARENA_STARTS_AT, endsAt = ARENA_ENDS_AT): Countdown {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (nowMs > end) return { state: "closed", days: 0, hours: 0, minutes: 0, label: "The arena has closed. See you at the winner reveal on 5 January." };
  const before = nowMs < start;
  const left = Math.max(0, (before ? start : end) - nowMs);
  return {
    state: before ? "before" : "open",
    days: Math.floor(left / 86_400_000),
    hours: Math.floor(left / 3_600_000) % 24,
    minutes: Math.floor(left / 60_000) % 60,
    label: before ? "until the arena opens" : "left in the arena",
  };
}

/** What the Today card says. `daysClosed` counts closes inside the window; `closedToday` is today's own close. */
export type ArenaCard =
  | { kind: "invite"; title: string; line: string }
  | { kind: "waiting"; title: string; line: string; huddle: string | null }
  | { kind: "day"; title: string; line: string; status: string; closedToday: boolean; huddle: string | null }
  | { kind: "after"; title: string; line: string };

export function arenaCard(input: { joined: boolean; today: string; daysClosed: number; closedToday: boolean; now: Date; config?: ArenaConfig }): ArenaCard | null {
  const c = input.config ?? ARENA;
  const phase = arenaPhase(c, input.today);
  const target = c.targetDays;
  const total = daysBetween(c.startDate, c.endDate);
  const h = nextHuddle(input.now);
  const huddle = h ? `Next Huddle: ${huddleWhen(h.startsAt)}` : null;
  if (!input.joined) {
    if (!joinOpen(c, input.today)) return null;
    return { kind: "invite", title: c.name, line: `Show up ${target} of ${total} days in December, together. Join by Thu 26 Nov.` };
  }
  if (phase === "before") {
    const wait = daysBetween(input.today, c.startDate) - 1;
    return { kind: "waiting", title: "You're in the Arena", line: wait === 1 ? "It opens tomorrow, Fri 27 Nov." : `It opens Fri 27 Nov, in ${wait} days.`, huddle };
  }
  if (phase === "closed") {
    return { kind: "after", title: "The Arena has closed", line: `You closed ${input.daysClosed} of ${total} days. The winners are revealed live on Tue 5 Jan.` };
  }
  const day = arenaDay(c, input.today) ?? 1;
  const reached = input.daysClosed >= target;
  return {
    kind: "day",
    title: `Day ${day} of ${total}`,
    line: reached ? `${input.daysClosed} days closed: you've completed the challenge.` : `${input.daysClosed} of ${target} days closed.`,
    status: input.closedToday ? "Today is closed." : "Close your day tonight to count it.",
    closedToday: input.closedToday,
    huddle,
  };
}

/** The coach's list, best first: most points in the window, then more days closed, then more calls booked (the page's tie-break). */
export function rankEntries<T extends { points: number; daysClosed: number; callsBooked: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.points - a.points || b.daysClosed - a.daysClosed || b.callsBooked - a.callsBooked);
}

/** The countdown as of now, for a server render's first numbers. */
export function countdownNow(): Countdown {
  return countdown(Date.now());
}

/**
 * What a challenge says on Colosseum → Challenges (H-1840, plan H-1844): one entry per challenge, keyed by its slug, so a
 * later challenge is a new entry and no page code. No prices and no internal names; Elite's own reward is not on the card.
 */
export type ChallengeCopy = { promise: string; rewards: readonly string[] };
export const CHALLENGE_COPY: Readonly<Record<string, ChallengeCopy>> = {
  [ARENA_SLUG]: {
    promise: "30 days. Close your day 24 times. Earn a free month.",
    rewards: ["Finish and you get one free month at your current level.", "The points leader gets Danno and the team's help building their webinar in January."],
  },
};

/** "Fri 27 Nov" for a date (YYYY-MM-DD), as the card states it. */
export function dayWords(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}

export type ChallengeSection = "upcoming" | "active" | "past";
export type ChallengeView = {
  section: ChallengeSection;
  name: string;
  promise: string | null;
  when: string;
  /** "Starts in 35 days", "Starts tomorrow", "Day 4 of 30", "Ended Sat 26 Dec". */
  countdown: string;
  finish: string;
  rewards: readonly string[];
};

/** The card for a challenge on a date in its own zone: which section it sits in, and its words. */
export function challengeView(c: Pick<ArenaConfig, "slug" | "name" | "startDate" | "endDate" | "joinBy" | "targetDays">, today: string): ChallengeView {
  const phase = arenaPhase(c, today);
  const days = daysBetween(c.startDate, c.endDate);
  const until = daysBetween(today, c.startDate) - 1;
  const copy = CHALLENGE_COPY[c.slug] ?? null;
  return {
    section: phase === "before" ? "upcoming" : phase === "open" ? "active" : "past",
    name: c.name,
    promise: copy?.promise ?? null,
    when: `${dayWords(c.startDate)} to ${dayWords(c.endDate)}. Join by ${dayWords(c.joinBy)}.`,
    countdown: phase === "before" ? (until === 1 ? "Starts tomorrow" : `Starts in ${until} days`) : phase === "open" ? `Day ${daysBetween(c.startDate, today)} of ${days}` : `Ended ${dayWords(c.endDate)}`,
    finish: `Close your day on ${c.targetDays} of the ${days} days.`,
    rewards: copy?.rewards ?? [],
  };
}

/*
 * PR B (plan H-1563): the leaderboard, pods and the Huddle check-in. Pure rules here; the reads and writes are in
 * src/lib/arena.ts.
 */

/** Pods of five, filled in join order. */
export const POD_SIZE = 5;
/** Points for "I'm here" at a Huddle: the same as a daily check-in. */
export const HUDDLE_POINTS = 10;
/** "I'm here" is live from 30 minutes before a Huddle to 90 minutes after it starts. */
export const HUDDLE_OPENS_BEFORE_MS = 30 * 60_000;
export const HUDDLE_CLOSES_AFTER_MS = 90 * 60_000;

/** The Huddle whose check-in is live at an instant, or null. */
export function huddleLive<T extends { startsAt: string }>(now: Date, huddles: readonly T[]): T | null {
  const t = now.getTime();
  return huddles.find((h) => {
    const s = Date.parse(h.startsAt);
    return t >= s - HUDDLE_OPENS_BEFORE_MS && t <= s + HUDDLE_CLOSES_AFTER_MS;
  }) ?? null;
}

/** "7:30 AM Pacific" for when a Huddle's check-in opens. */
export function huddleOpensWords(startsAt: string): string {
  const at = new Date(Date.parse(startsAt) - HUDDLE_OPENS_BEFORE_MS);
  return `${new Intl.DateTimeFormat("en-US", { timeZone: ARENA.timezone, hour: "numeric", minute: "2-digit" }).format(at).replace(":00", "")} Pacific`;
}

/**
 * Who goes in which pod: every entry without a pod (or with one that's gone) goes to the first pod with room, in join order,
 * and a new pod is made when all are full. Existing pods keep who they have, so a coach's moves stand. `pods` come in the
 * order they were made; a new pod is "Pod N", counting on from the pods there are.
 */
export type PodPlan = { create: string[]; assign: { entryId: string; pod: string }[] };
export function fillPods(entries: readonly { id: string; podId: string | null; joinedAt: string }[], pods: readonly { id: string }[], size = POD_SIZE): PodPlan {
  const count = new Map<string, number>(pods.map((p) => [p.id, 0]));
  for (const e of entries) if (e.podId && count.has(e.podId)) count.set(e.podId, count.get(e.podId)! + 1);
  const order = pods.map((p) => p.id);
  const create: string[] = [];
  const assign: { entryId: string; pod: string }[] = [];
  const waiting = entries.filter((e) => !e.podId || !count.has(e.podId)).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  for (const e of waiting) {
    let target = order.find((id) => count.get(id)! < size);
    if (!target) {
      target = `new:${create.length}`;
      create.push(`Pod ${pods.length + create.length + 1}`);
      order.push(target);
      count.set(target, 0);
    }
    count.set(target, count.get(target)! + 1);
    assign.push({ entryId: e.id, pod: target });
  }
  return { create, assign };
}

/** Day of the week for a date (0 Sunday, 1 Monday). */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The window's weeks, Monday to Sunday, the first and last cut to the window: 27 to 29 Nov, 30 Nov to 6 Dec, ... 21 to 26 Dec. */
export function arenaWeeks(c: Pick<ArenaConfig, "startDate" | "endDate">): { from: string; to: string }[] {
  const weeks: { from: string; to: string }[] = [];
  let from = c.startDate;
  while (from <= c.endDate) {
    const toSunday = (7 - weekday(from)) % 7;
    const sunday = addDays(from, toSunday);
    const to = sunday < c.endDate ? sunday : c.endDate;
    weeks.push({ from, to });
    from = addDays(to, 1);
  }
  return weeks;
}

/** The week whose leader is named on a date: the last week that has ended, so from Mon 30 Nov onward, and null before. */
export function leaderWeek(c: Pick<ArenaConfig, "startDate" | "endDate">, today: string): { from: string; to: string } | null {
  const done = arenaWeeks(c).filter((w) => w.to < today);
  return done.length ? done[done.length - 1] : null;
}

/** Midnight at the start of a date in Pacific, as a UTC instant. The window is all in standard time (UTC-8), as ARENA_STARTS_AT. */
export function pacificMidnight(date: string): string {
  return `${date}T08:00:00.000Z`;
}

/** A week's two instants for the ledger: from its first midnight to just before the midnight after its last day. */
export function weekInstants(w: { from: string; to: string }): { from: string; to: string } {
  return { from: pacificMidnight(w.from), to: new Date(Date.parse(pacificMidnight(addDays(w.to, 1))) - 1).toISOString() };
}

/** "27 to 29 Nov" or "30 Nov to 6 Dec" for a week. */
export function weekWords(w: { from: string; to: string }): string {
  const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));
  const [a, b] = [fmt(w.from), fmt(w.to)];
  return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]} to ${b}` : `${a} to ${b}`;
}

/** Places on the board after the page's rule (rankEntries); equal on all three counts share a place. */
export function placed<T extends { points: number; daysClosed: number; callsBooked: number }>(rows: readonly T[]): (T & { place: number })[] {
  const ranked = rankEntries(rows);
  let place = 0;
  return ranked.map((r, i) => {
    const prev = ranked[i - 1];
    if (!prev || prev.points !== r.points || prev.daysClosed !== r.daysClosed || prev.callsBooked !== r.callsBooked) place = i + 1;
    return { ...r, place };
  });
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
