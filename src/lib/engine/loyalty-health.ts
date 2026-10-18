/**
 * The loyalty health view (H-622 §2, plan H-734): the pure rules. A certificate is amber under 60 days, red under 14, and
 * named on Coach under 30. A board older than 30 minutes is stale. The 429 count covers a rolling 24 hours from the first one.
 */

export const DAY_MS = 86_400_000;
export const CERT_AMBER_DAYS = 60;
export const CERT_RED_DAYS = 14;
export const CERT_COACH_LINE_DAYS = 30;
export const STALE_BOARD_MS = 30 * 60_000;
export const RATE_WINDOW_MS = DAY_MS;

export type CertLevel = "none" | "ok" | "amber" | "red" | "expired";

/** Whole days from now to the expiry date (a YYYY-MM-DD date counts to the end of that day, UTC). */
export function daysLeft(expiresAt: string | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? Date.parse(`${expiresAt}T23:59:59Z`) : Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - now.getTime()) / DAY_MS);
}

export function certLevel(expiresAt: string | null | undefined, now: Date): CertLevel {
  const d = daysLeft(expiresAt, now);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d < CERT_RED_DAYS) return "red";
  if (d < CERT_AMBER_DAYS) return "amber";
  return "ok";
}

/** The words for a certificate: "312 days left", "Expires today", "Expired 3 days ago", or none. */
export function certWords(expiresAt: string | null | undefined, now: Date): string {
  const d = daysLeft(expiresAt, now);
  if (d === null) return "No date yet";
  if (d < 0) return `Expired ${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "Expires today";
  return `${d} day${d === 1 ? "" : "s"} left`;
}

/** A typed expiry date: YYYY-MM-DD, a real calendar date, or null for blank. Anything else is refused. */
export function readExpiry(input: string): { ok: true; value: string | null } | { ok: false } {
  const v = input.trim();
  if (!v) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { ok: false };
  return { ok: true, value: v };
}

/** A typed Pass Type ID: blank, or reverse-domain like pass.com.example (letters, digits, dots, hyphens). */
export function readPassTypeId(input: string): { ok: true; value: string | null } | { ok: false } {
  const v = input.trim();
  if (!v) return { ok: true, value: null };
  if (v.length > 200 || !/^pass(\.[A-Za-z0-9-]+)+$/.test(v)) return { ok: false };
  return { ok: true, value: v };
}

/** After a 429: the new count and time. A 429 more than 24 hours after the window began starts a new window. */
export function nextRateLimit(count: number, at: string | null | undefined, now: Date): { count: number; at: string } {
  const started = at ? Date.parse(at) : NaN;
  const inWindow = !Number.isNaN(started) && now.getTime() - started < RATE_WINDOW_MS;
  return inWindow ? { count: count + 1, at: at as string } : { count: 1, at: now.toISOString() };
}

/** The 429s to show now: the window's count, or 0 once 24 hours have passed. */
export function rateLimitsShown(count: number, at: string | null | undefined, now: Date): number {
  if (!at || !count) return 0;
  const started = Date.parse(at);
  return !Number.isNaN(started) && now.getTime() - started < RATE_WINDOW_MS ? count : 0;
}

/** How long ago, in words: "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoWords(iso: string | null | undefined, now: Date): string {
  if (!iso) return "never";
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "never";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function boardStale(cachedAt: string | null | undefined, now: Date): boolean {
  if (!cachedAt) return true;
  const t = Date.parse(cachedAt);
  return Number.isNaN(t) || now.getTime() - t > STALE_BOARD_MS;
}

export type OutboxCounts = { waiting: number; failed7: number; sent7: number; last: { at: string; status: string; note: string | null } | null };

/** The outbox for one program, from its moves: waiting now, failed and sent in the last 7 days, and the latest move. */
export function outboxCounts(moves: { status: string; createdAt: string; sentAt: string | null; lastNote: string | null }[], now: Date): OutboxCounts {
  const since = now.getTime() - 7 * DAY_MS;
  const when = (m: { createdAt: string; sentAt: string | null }) => Date.parse(m.sentAt ?? m.createdAt.replace(" ", "T") + (m.createdAt.includes("Z") ? "" : "Z"));
  let waiting = 0;
  let failed7 = 0;
  let sent7 = 0;
  let last: OutboxCounts["last"] = null;
  let lastT = -Infinity;
  for (const m of moves) {
    const t = when(m);
    if (m.status === "pending") waiting++;
    else if (m.status === "failed" && t >= since) failed7++;
    else if (m.status === "sent" && t >= since) sent7++;
    if (t > lastT) {
      lastT = t;
      last = { at: new Date(t).toISOString(), status: m.status, note: m.lastNote };
    }
  }
  return { waiting, failed7, sent7, last };
}

/** The programs to name on Coach: a certificate under 30 days (or expired), soonest first. */
export function certsToFlag<T extends { name: string; certExpiresAt: string | null }>(rows: T[], now: Date): { name: string; days: number }[] {
  return rows
    .map((r) => ({ name: r.name, days: daysLeft(r.certExpiresAt, now) }))
    .filter((r): r is { name: string; days: number } => r.days !== null && r.days < CERT_COACH_LINE_DAYS)
    .sort((a, b) => a.days - b.days);
}
