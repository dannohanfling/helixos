/**
 * Recordings for members (revs 496 to 498), with no database in them: a Fathom timestamp as a small "▶ 12:34" link that opens
 * the call at that moment (only ever a fathom.video address), the action items grouped under the person each is for (by email,
 * names only, never an address), the week headings on the member's list, and what is new for whom.
 */
import type { RecordingActionItem } from "@/db/schema";
import { addDays, formatDate, startOfWeek, todayInTz } from "@/lib/dates";
import { deepLink } from "./fathom";

/** An https address on fathom.video (or one of its subdomains): the only kind of link a recording's timestamp may open. */
export function isFathomUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && (url.hostname === "fathom.video" || url.hostname.endsWith(".fathom.video"));
  } catch {
    return false;
  }
}

/** "00:14:02" → "14:02", "01:02:03" → "1:02:03", "842" (seconds) → "14:02". */
export function timestampLabel(ts: string): string {
  const t = ts.trim();
  let secs: number;
  if (/^\d+(\.\d+)?$/.test(t)) secs = Math.floor(Number(t));
  else {
    const parts = t.split(":").map(Number);
    if (parts.some((p) => !Number.isFinite(p))) return t;
    secs = parts.reduce((a, p) => a * 60 + p, 0);
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Where an action item's timestamp opens: Fathom's own playback link when it is a fathom.video address, else the call's share
 * link at that second. Null with no timestamp, or when neither address is Fathom's: then no link is shown.
 */
export function itemMoment(item: Pick<RecordingActionItem, "timestamp" | "playbackUrl">, watch: string | null | undefined): { href: string; label: string } | null {
  if (!item.timestamp) return null;
  const label = `▶ ${timestampLabel(item.timestamp)}`;
  if (isFathomUrl(item.playbackUrl)) return { href: item.playbackUrl!, label };
  if (isFathomUrl(watch)) return { href: deepLink(watch!, item.timestamp), label };
  return null;
}

/** A link inside Fathom's summary ("[Topic](https://fathom.video/share/…?timestamp=724)"): its moment, or nothing for any other address. */
export function summaryMoment(url: string): { href: string; label: string } | null {
  if (!isFathomUrl(url)) return null;
  const t = new URL(url).searchParams.get("timestamp");
  return { href: url, label: t ? `▶ ${timestampLabel(t)}` : "▶" };
}

/** A person an action step can be for: a member, or a coach (whose steps are headed "<first name> (coach)"). */
export type ItemPerson = { name: string; email: string; coach?: boolean };
export type ItemGroup = { key: string; label: string; own: boolean; everyone: boolean; items: { item: RecordingActionItem; index: number }[] };
export const YOUR_STEPS = "Your action steps";
export const EVERYONE_STEPS = "Everyone / unassigned";

/** A timestamp in seconds, for ordering steps in call order; null when there is none or it can't be read. */
export function timestampSeconds(ts: string | null | undefined): number | null {
  const t = (ts ?? "").trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t));
  const parts = t.split(":").map(Number);
  return parts.length && parts.every((p) => Number.isFinite(p)) ? parts.reduce((a, p) => a * 60 + p, 0) : null;
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const first = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/**
 * The action steps under the person each is for (rev 496; Danno's rev 619 rules). A step is matched to a person by email, then
 * by full name; a member is headed by their own name, a coach "<first name> (coach)". A step with no one, or no one we can match,
 * goes under "Everyone / unassigned": never a guess from a first name, never an email shown. The viewer's own group comes first
 * ("Your action steps" for a member), the rest alphabetically, Everyone last; inside a group, steps run in call order.
 */
export function groupActionItems(items: RecordingActionItem[], people: ItemPerson[], viewer: { email: string; name: string; role: "coach" | "client" }): ItemGroup[] {
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [norm(p.email), p]));
  // A name matches only when exactly one person carries it.
  const nameCount = new Map<string, number>();
  for (const p of people) nameCount.set(norm(p.name), (nameCount.get(norm(p.name)) ?? 0) + 1);
  const byName = new Map(people.filter((p) => nameCount.get(norm(p.name)) === 1).map((p) => [norm(p.name), p]));
  const me = norm(viewer.email);
  const groups = new Map<string, ItemGroup>();
  items.forEach((item, index) => {
    const email = norm(item.assigneeEmail ?? "");
    const name = item.assigneeName && !item.assigneeName.includes("@") ? norm(item.assigneeName) : "";
    const person = (email ? byEmail.get(email) : undefined) ?? (name ? byName.get(name) : undefined);
    const own = Boolean(person && norm(person.email) === me) || (Boolean(email) && email === me);
    const key = own ? "own" : person ? `email:${norm(person.email)}` : "everyone";
    const label = own ? (viewer.role === "client" ? YOUR_STEPS : `${first(viewer.name)} (coach)`) : person ? (person.coach ? `${first(person.name)} (coach)` : person.name) : EVERYONE_STEPS;
    const g = groups.get(key) ?? { key, label, own, everyone: key === "everyone", items: [] };
    g.items.push({ item, index });
    groups.set(key, g);
  });
  const all = [...groups.values()];
  for (const g of all) g.items.sort((x, y) => (timestampSeconds(x.item.timestamp) ?? Number.MAX_SAFE_INTEGER) - (timestampSeconds(y.item.timestamp) ?? Number.MAX_SAFE_INTEGER) || x.index - y.index);
  const rest = all.filter((g) => !g.own && !g.everyone).sort((x, y) => x.label.localeCompare(y.label));
  return [...all.filter((g) => g.own), ...rest, ...all.filter((g) => g.everyone)];
}

/** The heading a recording sits under on the member's list: "This week", "Last week", then the week's Monday. */
export function weekHeading(startedAt: string | null, tz: string, now: Date = new Date()): string {
  if (!startedAt) return "Date unknown";
  const day = todayInTz(tz, new Date(startedAt));
  const thisWeek = startOfWeek(todayInTz(tz, now));
  const week = startOfWeek(day);
  if (week === thisWeek) return "This week";
  if (week === addDays(thisWeek, -7)) return "Last week";
  return `Week of ${formatDate(week)}`;
}
