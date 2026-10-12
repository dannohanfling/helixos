/**
 * Bot connection (rev 696, Danno's answers at rev 808), the pure parts: a member's Community Loyalty bot calls HelixOS mid-chat
 * through its own small MCP server, with one key per member's bot. Anyone who messages the bot can make it call these tools, so
 * every input here is a stranger's: cleaned, length-limited and refused when too long, never trusted. Nothing here reads the
 * database or the network.
 */
import { formatPrice } from "@/lib/engine/offer-score";

/** The seven tools, and nothing else: the never-list (Essence, numbers, tasks, Proof Bank, other prospects...) has no tool. mf_prepare is the Magic funnel's (rev 812 §6). */
export const BOT_TOOLS = ["offer_info", "faq_answer", "booking_info", "webinar_next", "lead_log", "webinar_register", "mf_prepare"] as const;
export type BotTool = (typeof BOT_TOOLS)[number];
export const WRITE_TOOLS: readonly BotTool[] = ["lead_log", "webinar_register", "mf_prepare"];
export const isWrite = (t: string) => (WRITE_TOOLS as readonly string[]).includes(t);

/** A bot key: "hxb_" and 32 random bytes. Never the member connector's "mcpa_" shape, so neither server takes the other's. */
export const BOT_KEY_PREFIX = "hxb_";
export const isBotKeyShape = (k: string) => /^hxb_[A-Za-z0-9_-]{43}$/.test(k);
/** The cookie that carries a new key to the page that shows it once (ten minutes, httpOnly). */
export const BOT_KEY_COOKIE = "hx_bot_key_once";

/** Per key: reads a minute, writes a minute; writes a day per member. */
export const LIMITS = { readsPerMinute: 60, writesPerMinute: 10, writesPerDay: 200 } as const;
/** What the bot can say when a limit is hit. */
export const BUSY_LINE = "I can't do that right now. Please try again in a minute.";

/** The longest each input may be; longer is refused, not cut. */
export const MAX = { name: 60, channel: 30, note: 280, question: 300, email: 254, contactId: 64, timezone: 64, customKey: 40, customValue: 300, customFields: 12 } as const;

/**
 * A stranger's text, made safe to store and show: control and zero-width characters out, any run of white space one space,
 * trimmed. Angle brackets go too, so nothing that looks like markup is kept.
 */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const isEmail = (s: string) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= MAX.email;
export const isContactId = (s: string) => /^[A-Za-z0-9_.:-]{1,64}$/.test(s);
export function isTimezone(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) || tz.length > MAX.timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ───────────────────────── lead_log ───────────────────────── */

/** The stages the bot may set, as DMs know them (rev 808): qualified is In conversation, booked is Call booked, no-show its own. */
export const BOT_STAGES = ["new", "qualified", "booked", "no_show"] as const;
export type BotStage = (typeof BOT_STAGES)[number];
export const STAGE_FROM_BOT: Record<BotStage, "new" | "conversation" | "call_booked" | "no_show"> = { new: "new", qualified: "conversation", booked: "call_booked", no_show: "no_show" };
/** How far along each DMs stage is: the bot never moves a person back (a client stays a client; booked doesn't drop to new). */
const RANK: Record<string, number> = { cold: 0, new: 1, replied: 2, conversation: 3, no_show: 4, call_booked: 4, client: 6 };
export function nextStage(current: string | null, asked: BotStage): string {
  const want = STAGE_FROM_BOT[asked];
  if (!current) return want;
  // No-show and booked are the same rung: a booked call can become a no-show, and a no-show can book again.
  return (RANK[want] ?? 0) >= (RANK[current] ?? 0) ? want : current;
}

/** "booked_on" as the bot sends it (a date or a date and time), as the stored instant; today when it's missing or unreadable. */
export function bookedOnIso(raw: string | undefined, now: Date): string {
  if (raw && /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw.trim())) {
    const s = raw.trim();
    const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s.replace(" ", "T")).getTime();
    if (!Number.isNaN(t) && Math.abs(t - now.getTime()) < 400 * 86_400_000) return new Date(t).toISOString();
  }
  return now.toISOString();
}

/** A note from the bot, added as its own dated line under what the member already wrote; never replacing it. */
export function withNote(existing: string | null, note: string, day: string): string {
  const line = `${day} (bot): ${note}`;
  const before = (existing ?? "").trim();
  const joined = before ? `${before}\n${line}` : line;
  return joined.length > 8000 ? joined.slice(joined.length - 8000) : joined;
}

/* ───────────────────────── webinar_register: custom fields for the Magic funnel ───────────────────────── */

/** The fields a sign-up can carry for their own page later (rev 808), plus any custom ones the flow names. */
export const KNOWN_FIELDS = ["industry", "pain", "problem", "desire"] as const;

/** Custom fields from a stranger: at most 12, keys of letters, digits and underscores, each value cleaned and at most 300. */
export function cleanCustom(raw: Record<string, unknown> | undefined): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  if (!raw) return { ok: true, fields: {} };
  const entries = Object.entries(raw);
  if (entries.length > MAX.customFields) return { ok: false, error: `At most ${MAX.customFields} custom fields.` };
  const fields: Record<string, string> = {};
  for (const [k, v] of entries) {
    const key = k.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return { ok: false, error: `A custom field's name is letters, digits and _ (40 at most): ${key.slice(0, 40)}` };
    if (typeof v !== "string") return { ok: false, error: `Custom field ${key} must be text.` };
    if (v.length > MAX.customValue * 2) return { ok: false, error: `Custom field ${key} is too long (${MAX.customValue} characters at most).` };
    const value = cleanText(v);
    if (value.length > MAX.customValue) return { ok: false, error: `Custom field ${key} is too long (${MAX.customValue} characters at most).` };
    if (value) fields[key] = value;
  }
  return { ok: true, fields };
}

/** A sign-up's personal link code, set aside for their own funnel page: 32 random bytes, URL-safe (43 characters). */
export const PAGE_CODE_BYTES = 32;

/* ───────────────────────── offer_info ───────────────────────── */

export type OfferRow = { name: string; botName: string | null; botRole: string; status: string; createdAt: string; promise: string | null; botFor: string | null; forYouIf: string | null; container: string; price: number; currency: string | null; neverQuotePrice: boolean };
export type PriceRules = { pricesOn: boolean; priceMode: string; priceAnswer: string };

/**
 * The offers the bot may talk about: those with a bot role, the main one first (the core offer, else the entry offer, else the
 * newest live one: the same pick the bot's own fields use). A price only when the member has prices on, the offer doesn't say
 * "never quote prices", and there is one; otherwise the member's price answer, with no numbers.
 */
export function offerFacts(offers: OfferRow[], rules: PriceRules) {
  const onBot = offers.filter((o) => o.botRole !== "not_on_bot" && o.status !== "retired");
  const main = onBot.find((o) => o.botRole === "core") ?? onBot.find((o) => o.botRole === "entry") ?? [...onBot].filter((o) => o.status === "live").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const ordered = main ? [main, ...onBot.filter((o) => o !== main)] : onBot;
  return ordered.map((o) => {
    const quote = rules.pricesOn && rules.priceMode !== "never" && !o.neverQuotePrice && o.price > 0;
    return {
      name: o.botName?.trim() || o.name,
      main: o === main,
      promise: o.promise?.trim() || null,
      for: o.botFor?.trim() || o.forYouIf?.trim() || null,
      container: o.container.trim() || null,
      price: quote ? formatPrice(o.price, o.currency) : null,
      price_answer: quote ? null : rules.priceAnswer,
    };
  });
}

/* ───────────────────────── faq_answer ───────────────────────── */

const STOP = new Set("a an and are as at be but by can do does for from how i if in is it me my of on or so that the this to was we what when where which who why will with you your".split(" "));
const words = (s: string) => new Set(cleanText(s.toLowerCase()).replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w)));

export type FaqRow = { question: string; alsoAsked: string[]; keywords: string[]; answer: string };
/** The best three FAQ entries for a question, by the words they share with it (keywords count double); none when nothing matches. */
export function faqMatches(question: string, rows: FaqRow[], limit = 3): { question: string; answer: string }[] {
  const asked = words(question);
  if (!asked.size) return [];
  return rows
    .map((r) => {
      const said = words([r.question, ...r.alsoAsked].join(" "));
      const keys = words(r.keywords.join(" "));
      let score = 0;
      for (const w of asked) score += (said.has(w) ? 1 : 0) + (keys.has(w) ? 2 : 0);
      return { r, score };
    })
    .filter((x) => x.score > 0 && x.r.answer.trim())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => ({ question: r.question, answer: r.answer }));
}

/* ───────────────────────── webinar_next ───────────────────────── */

export type WebinarRow = { id: string; title: string; status: string; isExample: boolean; scheduledAt: string | null; registrationUrl: string | null; joinUrl: string | null };
/** The next webinar: the earliest that isn't an example and starts after now (its time read in the member's own zone). */
export function nextWebinar<T extends WebinarRow>(rows: T[], now: Date, toUtc: (wall: string) => string | null): (T & { startsAt: string }) | null {
  const ahead = rows
    .filter((w) => !w.isExample && w.scheduledAt && w.status !== "delivered")
    .map((w) => ({ w, at: toUtc(w.scheduledAt!) }))
    .filter((x): x is { w: T; at: string } => Boolean(x.at) && new Date(x.at!).getTime() > now.getTime())
    .sort((a, b) => a.at.localeCompare(b.at));
  return ahead[0] ? { ...ahead[0].w, startsAt: ahead[0].at } : null;
}

/** "Thursday, October 15 at 7:00 PM EDT", in the asker's zone when the bot passes a real one, else the member's. */
export function whenLine(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
