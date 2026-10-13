/**
 * A loyalty-pass leaderboard (rev 639, H-29), the pure parts: an eLoyalty (WalletPush) customer turned into one public row,
 * "Maria S." with points and a tier and nothing else; the members left out; the client's page settings (copy, tiers,
 * rewards, the pass link) with the 9 Oct design's samples as defaults; a pasted export stripped on the way in; the model the
 * hosted page renders; and a last guard that no row carries an email or a phone-like number.
 *
 * Tiers come from HelixOS config by lifetime points (H-28, H-33): eLoyalty holds no tiers for these programs, so
 * `membership_tier` is never read. The feed's shape is the one the page has always read.
 */
export type FeedMember = { name: string; lifetime: number; available: number; tier: string };
export type Feed = { updated_at: string; members: FeedMember[] };
export type Customer = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?[\d,]+(\.\d+)?$/.test(v.trim()) ? Number(v.trim().replace(/,/g, "")) : 0);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** "maria jose" + "santos" → "Maria S."; no first name → null (nothing to show). */
export function displayName(first: unknown, last: unknown): string | null {
  const f = str(first).split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
  if (!f) return null;
  const l = str(last).replace(/[^\p{L}]/gu, "").charAt(0).toUpperCase();
  return l ? `${cap(f)} ${l}.` : cap(f);
}

/** A placeholder or a test person, by name: the pass's "John Doe" and anything with "test" in it. */
export const isPlaceholderName = (first: unknown, last: unknown): boolean => {
  const full = `${str(first)} ${str(last)}`.trim().toLowerCase();
  return full === "john doe" || /test/.test(full);
};

/**
 * Who is never on the board: inactive, on the hide list, the pass placeholder, any test name; and, unless the client shows
 * them (the default since H-33), members with no lifetime points yet.
 */
export function leaveOut(c: Customer, hidden: ReadonlySet<string>, opts: { showZero?: boolean } = {}): boolean {
  if (c.is_active === false || c.is_active === "false" || c.is_active === 0) return true;
  if (!opts.showZero && num(c.points_earned) <= 0) return true;
  if (hidden.has(str(c.id))) return true;
  return isPlaceholderName(c.first_name, c.last_name);
}

/** A kept member as the server holds it: the eLoyalty id only so the hide list can apply; the id never leaves in a feed. */
export type BoardRow = { id: string; name: string; lifetime: number; available: number };

/** Two templates read during a pass migration (H-32): one list, nobody counted twice (the first copy of an id wins). */
export function mergeCustomers(lists: readonly (readonly Customer[])[]): Customer[] {
  const seen = new Set<string>();
  const out: Customer[] = [];
  for (const list of lists)
    for (const c of list) {
      const id = str(c.id);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(c);
    }
  return out;
}

/** The members kept, as rows, most lifetime points first. Every other field of a customer is dropped here. */
export function boardRows(customers: readonly Customer[]): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const c of customers) {
    // Zero-point members are kept here and decided at serve time, so a saved board answers either setting.
    if (leaveOut(c, new Set(), { showZero: true })) continue;
    const name = displayName(c.first_name, c.last_name);
    if (!name) continue;
    rows.push({ id: str(c.id), name, lifetime: num(c.points_earned), available: num(c.points_balance) });
  }
  return sortRows(rows);
}

export const sortRows = <T extends { lifetime: number; name: string }>(rows: T[]): T[] => rows.sort((a, b) => b.lifetime - a.lifetime || a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------------------------------------------------------
// The client's page settings (H-28): copy, the pass link, tiers and rewards, with the 9 Oct design's samples as the defaults.

export type Tier = { name: string; min: number };
export type Reward = { name: string; cost: number | null; desc: string };
export type PageConfig = {
  eyebrow: string;
  headline: string;
  /** The italic word inside the headline, "Koin" in "Kindness Koin Leaderboard"; blank for none. */
  headlineEm: string;
  quote: string;
  intro: string;
  footer: string;
  /** The program's public "get your pass" link (https only); never a member's own pass URL. */
  passUrl: string;
  /** What a point is called, "KK" on Christian's board. */
  unit: string;
  tiers: Tier[];
  rewards: Reward[];
  tiersSample: boolean;
  rewardsSample: boolean;
  showZero: boolean;
};

export const MAX_TIERS = 9;
export const MAX_REWARDS = 20;

/** The 9 Oct design's own placeholders, marked Sample until the client's team confirms theirs. */
export const SAMPLE_TIERS: Tier[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n, i) => ({ name: `Gate ${n}`, min: [0, 100, 250, 500, 800, 1200, 1700, 2300, 3000][i] }));
export const SAMPLE_REWARDS: Reward[] = [
  { name: "Identity Shift Audio", cost: 100, desc: "A guided audio to anchor who you're becoming" },
  { name: "Compounding Kindness Journal", cost: 250, desc: "The printed journal, mailed to you" },
  { name: "Movement Spotlight", cost: 400, desc: "Featured in the weekly community digest" },
  { name: "Mentor Circle", cost: 600, desc: "Guide newer members on the path" },
  { name: "Peer Mastermind", cost: 900, desc: "Join a mastermind with peers on the same path" },
  { name: "Clarity Call", cost: 1200, desc: "A private call with founding members" },
  { name: "One-on-One with Christian", cost: 2000, desc: "A personalized session with Christian Raphael" },
  { name: "Legacy Designation", cost: 3000, desc: "A numbered certificate, a place in the archive and the annual Legacy Gathering" },
];

export const DEFAULT_PAGE: PageConfig = {
  eyebrow: "THE COMPOUNDING KINDNESS PASS",
  headline: "Kindness Koin Leaderboard",
  headlineEm: "Koin",
  quote: "“A community where every kindness ripples growth.”",
  intro: "Every verified act of kindness adds Kindness Koin (KK) to your record. Lifetime KK never goes down. Available KK is what you can redeem for rewards right now.",
  footer: "© 2026 Christian Raphael Hypnotherapy · Albuquerque, New Mexico",
  passUrl: "",
  unit: "KK",
  tiers: SAMPLE_TIERS,
  rewards: SAMPLE_REWARDS,
  tiersSample: true,
  rewardsSample: true,
  showZero: true,
};

const line = (v: unknown, max: number) => str(v).replace(/\s+/g, " ").slice(0, max);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Only an https address is kept for the pass link; anything else (a bare host, javascript:, a member's pass URL style) is dropped. */
export function readPassUrl(v: unknown): string {
  const s = str(v).slice(0, 500);
  if (!/^https:\/\/[\w.-]+(:\d+)?(\/[^\s"'<>]*)?$/.test(s)) return "";
  return s;
}

/** Tiers from "name, min" lines (also "name|min" or a tab): named, sorted by threshold, once per threshold, at most nine. */
export function readTiers(text: string): Tier[] {
  const out: Tier[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/[,|\t]/).map((p) => p.trim());
    if (parts.length < 2) continue;
    const name = line(parts[0], 60);
    const min = Math.max(0, Math.floor(num(parts[1])));
    if (!name || !/^\d[\d,]*$/.test(parts[1])) continue;
    if (out.some((t) => t.min === min)) continue;
    out.push({ name, min });
  }
  return out.sort((a, b) => a.min - b.min).slice(0, MAX_TIERS);
}

/** Rewards from "name | cost | one line" lines, cheapest first, at most twenty; a reward without a cost reads "—". */
export function readRewards(text: string): Reward[] {
  const out: Reward[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split("|").map((p) => p.trim());
    const name = line(parts[0], 80);
    if (!name) continue;
    const cost = parts[1] && /^\d[\d,]*$/.test(parts[1]) ? Math.floor(num(parts[1])) : null;
    out.push({ name, cost, desc: line(parts[2] ?? "", 200) });
  }
  return out.sort((a, b) => (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER)).slice(0, MAX_REWARDS);
}

export const tiersText = (tiers: readonly Tier[]): string => tiers.map((t) => `${t.name}, ${t.min}`).join("\n");
export const rewardsText = (rewards: readonly Reward[]): string => rewards.map((r) => `${r.name} | ${r.cost ?? ""} | ${r.desc}`).join("\n");

/** The saved settings, whole: anything missing or malformed takes the design's default. */
export function readPageConfig(json: string | null | undefined): PageConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = json ? JSON.parse(json) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const tiers = Array.isArray(raw.tiers) ? readTiers(raw.tiers.map((t) => (t && typeof t === "object" ? `${(t as Tier).name}|${(t as Tier).min}` : "")).join("\n")) : DEFAULT_PAGE.tiers;
  const rewards = Array.isArray(raw.rewards) ? readRewards(raw.rewards.map((r) => (r && typeof r === "object" ? `${(r as Reward).name}|${(r as Reward).cost ?? ""}|${(r as Reward).desc ?? ""}` : "")).join("\n")) : DEFAULT_PAGE.rewards;
  return {
    eyebrow: "eyebrow" in raw ? line(raw.eyebrow, 80) : DEFAULT_PAGE.eyebrow,
    headline: ("headline" in raw && line(raw.headline, 80)) || DEFAULT_PAGE.headline,
    headlineEm: "headlineEm" in raw ? line(raw.headlineEm, 40) : DEFAULT_PAGE.headlineEm,
    quote: "quote" in raw ? line(raw.quote, 200) : DEFAULT_PAGE.quote,
    intro: "intro" in raw ? line(raw.intro, 400) : DEFAULT_PAGE.intro,
    footer: "footer" in raw ? line(raw.footer, 160) : DEFAULT_PAGE.footer,
    passUrl: readPassUrl(raw.passUrl),
    unit: ("unit" in raw && line(raw.unit, 12)) || DEFAULT_PAGE.unit,
    tiers,
    rewards,
    tiersSample: bool(raw.tiersSample, DEFAULT_PAGE.tiersSample),
    rewardsSample: bool(raw.rewardsSample, DEFAULT_PAGE.rewardsSample),
    showZero: bool(raw.showZero, DEFAULT_PAGE.showZero),
  };
}

/** The editor's fields into settings: the same reading as a saved copy, so what is saved is what would be read. */
export function pageConfigFromForm(f: Record<string, string>): PageConfig {
  return readPageConfig(
    JSON.stringify({
      eyebrow: f.eyebrow ?? "",
      headline: f.headline ?? "",
      headlineEm: f.headlineEm ?? "",
      quote: f.quote ?? "",
      intro: f.intro ?? "",
      footer: f.footer ?? "",
      passUrl: f.passUrl ?? "",
      unit: f.unit ?? "",
      tiers: readTiers(f.tiers ?? ""),
      rewards: readRewards(f.rewards ?? ""),
      tiersSample: f.tiersSample === "on",
      rewardsSample: f.rewardsSample === "on",
      showZero: f.showZero === "on",
    }),
  );
}

/** The tier a lifetime total has reached (the highest gate at or below it) and the next gate, if any. */
export function tierFor(lifetime: number, tiers: readonly Tier[]): { cur: Tier | null; next: Tier | null } {
  let cur: Tier | null = null;
  let next: Tier | null = null;
  for (const t of tiers) {
    if (lifetime >= t.min) cur = t;
    else {
      next = t;
      break;
    }
  }
  return { cur, next };
}

/** The public feed from the held rows: the client's hide list and zero rule applied now, tiers from config, the ids gone. */
export function publicFeed(rows: readonly BoardRow[], hidden: readonly string[], updatedAt: string, config: Pick<PageConfig, "tiers" | "showZero"> = DEFAULT_PAGE): Feed {
  const hide = new Set(hidden.map((h) => h.trim()).filter(Boolean));
  return {
    updated_at: updatedAt,
    members: rows.filter((r) => !hide.has(r.id) && (config.showZero || r.lifetime > 0)).map(({ name, lifetime, available }) => ({ name, lifetime, available, tier: tierFor(lifetime, config.tiers).cur?.name ?? "" })),
  };
}

/** The board straight from customers (rows, then the hide list). */
export const buildFeed = (customers: readonly Customer[], hidden: readonly string[], nowIso: string, config: Pick<PageConfig, "tiers" | "showZero"> = DEFAULT_PAGE): Feed => publicFeed(boardRows(customers), hidden, nowIso, config);

/** The last guard before member data leaves: no "@" and no run of seven or more digits anywhere in it. */
export const textIsClean = (text: string): boolean => !text.includes("@") && !/\d{7,}/.test(text);
export const feedIsClean = (feed: Feed): boolean => textIsClean(JSON.stringify(feed.members));

/** The field names a customer came with, for the coach's check note: names only, never a value. */
export const fieldNames = (c: Customer | undefined): string[] => (c ? Object.keys(c).sort() : []);

/** "One per line" from the client's Settings into ids: trimmed, once each, at most 500. */
export const readHidden = (text: string): string[] => [...new Set(text.split(/[\n,]+/).map((x) => x.trim()).filter((x) => /^[\w-]{1,80}$/.test(x)))].slice(0, 500);

/** A feed address from the client's name and a random tail: "christian-raphael-k3f9q2". */
export function feedSlug(name: string, tail: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "leaderboard";
  return `${base}-${tail}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pasted export (H-28): a Points & Transactions export read on the server, on save, and stripped before anything is kept.

export type ExportRow = { name: string; lifetime: number; available: number | null };
export const MAX_EXPORT_ROWS = 2000;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  const t = text.replace(/^﻿/, "").trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  row.push(f);
  rows.push(row);
  return rows.filter((r) => r.join("").trim() !== "");
}

/**
 * The export's rows as the board holds them: "First L.", lifetime and available only. Emails, phones, ids, serials and
 * every other column are read past and thrown away here; an id column, when there is one, applies the hide list once and
 * is not kept. The same leave-out rules as the live board.
 */
export function parseExport(text: string, hidden: readonly string[] = []): { rows: ExportRow[]; hasAvailable: boolean; skipped: number } {
  const raw = parseCsv(text).slice(0, MAX_EXPORT_ROWS + 1);
  const head = (raw.shift() ?? []).map((h) => h.toLowerCase().trim());
  const col = (re: RegExp, not?: RegExp) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iF = col(/first/);
  const iL = col(/last|surname/);
  const iN = col(/^(full )?name$|member/);
  const iA = col(/avail|redeemable|balance|spendable|can redeem/);
  const iR = col(/redeemed|spent|used/);
  const iT = col(/lifetime|total|earned|points|koin|\bkk\b/, /avail|redeem|balance|spendable|spent|used/);
  const iId = col(/^(customer[ _-]?)?id$|customer/);
  const iActive = col(/active/);
  const hide = new Set(hidden.map((h) => h.trim()).filter(Boolean));
  const rows: ExportRow[] = [];
  let skipped = 0;
  for (const r of raw) {
    let first: string;
    let last: string;
    if (iF > -1) {
      first = r[iF] ?? "";
      last = iL > -1 ? (r[iL] ?? "") : "";
    } else {
      const p = String(r[iN > -1 ? iN : 0] ?? "")
        .trim()
        .split(/\s+/);
      first = p[0] ?? "";
      last = p.length > 1 ? p[p.length - 1] : "";
    }
    const active = iActive > -1 ? !/^(false|0|no|inactive)$/i.test((r[iActive] ?? "").trim()) : true;
    const name = displayName(first, last);
    if (!name || !active || isPlaceholderName(first, last) || (iId > -1 && hide.has((r[iId] ?? "").trim()))) {
      skipped++;
      continue;
    }
    const lifetime = iT > -1 ? num(r[iT]) : 0;
    const available = iA > -1 ? num(r[iA]) : iR > -1 ? Math.max(0, lifetime - num(r[iR])) : null;
    rows.push({ name, lifetime, available });
  }
  return { rows: sortRows(rows), hasAvailable: iA > -1 || iR > -1, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The hosted page's model (H-28): what /lb/<slug> renders, from rows and settings, with nothing else in it.

export type Source = { kind: "live"; at: string } | { kind: "export"; at: string | null } | { kind: "sample" };
export type PageMember = Omit<FeedMember, "available"> & { available: number | null; rank: number; next: Tier | null; pct: number; toNext: number | null };
export type PageModel = {
  config: PageConfig;
  source: Source;
  members: PageMember[];
  hasAvailable: boolean;
  stats: { members: number; lifetime: number; available: number | null };
  podium: PageMember[];
  rewards: (Reward & { canRedeem: number | null })[];
  updatedLabel: string;
};

/** The design's sample people (invented), shown marked Sample until an export or a live key is in. */
export const SAMPLE_ROWS: ExportRow[] = [
  ["Maria", "Santos", 2450, 900],
  ["James", "Okafor", 1980, 1980],
  ["Elena", "Vasquez", 1720, 520],
  ["Robert", "Chen", 1310, 1310],
  ["Aisha", "Patel", 1105, 405],
  ["Thomas", "Reyes", 940, 940],
  ["Grace", "Whitfield", 815, 215],
  ["David", "Morales", 690, 690],
  ["Linda", "Harper", 560, 160],
  ["Samuel", "Ortiz", 430, 430],
  ["Nina", "Brooks", 310, 110],
  ["Carlos", "Mendez", 240, 240],
  ["Hannah", "Lee", 150, 150],
  ["Peter", "Walsh", 90, 90],
  ["Rosa", "Garcia", 40, 40],
].map(([f, l, lifetime, available]) => ({ name: displayName(f, l)!, lifetime: lifetime as number, available: available as number }));

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
};

export function pageModel(rows: readonly ExportRow[], config: PageConfig, source: Source): PageModel {
  const kept = sortRows(rows.filter((r) => config.showZero || r.lifetime > 0).map((r) => ({ ...r })));
  const hasAvailable = kept.some((r) => r.available != null);
  const members: PageMember[] = [];
  let rank = 0;
  let prev: number | null = null;
  kept.forEach((r, i) => {
    if (r.lifetime !== prev) {
      rank = i + 1;
      prev = r.lifetime;
    }
    const { cur, next } = tierFor(r.lifetime, config.tiers);
    const base = cur?.min ?? 0;
    const span = next ? next.min - base : 0;
    const pct = next ? (span > 0 ? Math.min(100, Math.max(0, ((r.lifetime - base) / span) * 100)) : 100) : 100;
    members.push({ name: r.name, lifetime: r.lifetime, available: r.available, tier: cur?.name ?? "", rank, next, pct: Math.round(pct), toNext: next ? next.min - r.lifetime : null });
  });
  const rewards = config.rewards.map((rw) => ({ ...rw, canRedeem: hasAvailable && rw.cost != null ? members.filter((m) => (m.available ?? 0) >= rw.cost!).length : null }));
  const updatedLabel = source.kind === "live" ? `Live · updated ${fmtDate(source.at)}` : source.kind === "export" && source.at ? `Updated ${source.at}` : "";
  return {
    config,
    source,
    members,
    hasAvailable,
    stats: { members: members.length, lifetime: members.reduce((s, m) => s + m.lifetime, 0), available: hasAvailable ? members.reduce((s, m) => s + (m.available ?? 0), 0) : null },
    podium: members.slice(0, 3),
    rewards,
    updatedLabel,
  };
}

/** The page's member data as text, for the clean guard: names and numbers only, never the settings' copy (a link has digits). */
export const pageMembersText = (m: PageModel): string => JSON.stringify(m.members.map(({ name, lifetime, available, tier }) => ({ name, lifetime, available, tier })));

/** "2,450"; "—" for nothing. */
export const fmt = (n: number | null | undefined): string => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
