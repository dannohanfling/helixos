/**
 * A loyalty-pass leaderboard feed (rev 639), the pure parts: an eLoyalty (WalletPush) customer turned into one public row,
 * "Maria S." with points and a tier and nothing else, the members left out, and a last guard that no row carries an email
 * or a phone-like number. The page that reads the feed already expects exactly this shape.
 */
export type FeedMember = { name: string; lifetime: number; available: number; tier: string };
export type Feed = { updated_at: string; members: FeedMember[] };
export type Customer = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : 0);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** "maria jose" + "santos" → "Maria S."; no first name → null (nothing to show). */
export function displayName(first: unknown, last: unknown): string | null {
  const f = str(first).split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
  if (!f) return null;
  const l = str(last).replace(/[^\p{L}]/gu, "").charAt(0).toUpperCase();
  return l ? `${cap(f)} ${l}.` : cap(f);
}

/** Who is never on the board: inactive, no lifetime points, on the hide list, the pass placeholder, any test name. */
export function leaveOut(c: Customer, hidden: ReadonlySet<string>): boolean {
  if (c.is_active === false || c.is_active === "false" || c.is_active === 0) return true;
  if (num(c.points_earned) <= 0) return true;
  if (hidden.has(str(c.id))) return true;
  const full = `${str(c.first_name)} ${str(c.last_name)}`.trim().toLowerCase();
  if (full === "john doe" || /test/.test(full)) return true;
  return false;
}

/** A kept member as the server holds it: the eLoyalty id only so the hide list can apply; the id never leaves in a feed. */
export type BoardRow = FeedMember & { id: string };

/** The members kept, as rows, most lifetime points first. Every other field of a customer is dropped here. */
export function boardRows(customers: readonly Customer[]): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const c of customers) {
    if (leaveOut(c, new Set())) continue;
    const name = displayName(c.first_name, c.last_name);
    if (!name) continue;
    rows.push({ id: str(c.id), name, lifetime: num(c.points_earned), available: num(c.points_balance), tier: str(c.membership_tier) });
  }
  rows.sort((a, b) => b.lifetime - a.lifetime || a.name.localeCompare(b.name));
  return rows;
}

/** The public feed from the held rows: the client's hide list applied now, the ids gone. */
export function publicFeed(rows: readonly BoardRow[], hidden: readonly string[], updatedAt: string): Feed {
  const hide = new Set(hidden.map((h) => h.trim()).filter(Boolean));
  return { updated_at: updatedAt, members: rows.filter((r) => !hide.has(r.id)).map(({ name, lifetime, available, tier }) => ({ name, lifetime, available, tier })) };
}

/** The board straight from customers (rows, then the hide list). */
export const buildFeed = (customers: readonly Customer[], hidden: readonly string[], nowIso: string): Feed => publicFeed(boardRows(customers), hidden, nowIso);

/** The last guard before a feed leaves: no "@" and no run of seven or more digits anywhere in it. */
export function feedIsClean(feed: Feed): boolean {
  const text = JSON.stringify(feed.members);
  return !text.includes("@") && !/\d{7,}/.test(text);
}

/** The field names a customer came with, for the coach's check note: names only, never a value. */
export const fieldNames = (c: Customer | undefined): string[] => (c ? Object.keys(c).sort() : []);

/** "One per line" from the client's Settings into ids: trimmed, once each, at most 500. */
export const readHidden = (text: string): string[] => [...new Set(text.split(/[\n,]+/).map((x) => x.trim()).filter((x) => /^[\w-]{1,80}$/.test(x)))].slice(0, 500);

/** A feed address from the client's name and a random tail: "christian-raphael-k3f9q2". */
export function feedSlug(name: string, tail: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "leaderboard";
  return `${base}-${tail}`;
}
