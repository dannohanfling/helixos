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

export type ItemPerson = { name: string; email: string };
export type ItemGroup = { key: string; label: string; own: boolean; items: { item: RecordingActionItem; index: number }[] };

/**
 * The action items under the person each is for, in Fathom's order within a group (rev 496). A person is matched by email to a
 * member or a coach and shown by name; someone else by the name Fathom gives, never an email; no name and no email is
 * "Unassigned", last. The viewer's own group comes first, headed "Yours" for a member and with their name for the coach.
 */
export function groupActionItems(items: RecordingActionItem[], people: ItemPerson[], viewer: { email: string; name: string; role: "coach" | "client" }): ItemGroup[] {
  const byEmail = new Map(people.map((p) => [p.email.trim().toLowerCase(), p.name]));
  const me = viewer.email.trim().toLowerCase();
  const groups = new Map<string, ItemGroup>();
  items.forEach((item, index) => {
    const email = (item.assigneeEmail ?? "").trim().toLowerCase();
    const known = email ? byEmail.get(email) : undefined;
    const name = item.assigneeName?.trim() && !item.assigneeName.includes("@") ? item.assigneeName.trim() : null;
    const own = Boolean(email) && email === me;
    const key = own ? "own" : email && known ? `email:${email}` : name ? `name:${name.toLowerCase()}` : "unassigned";
    const label = own ? (viewer.role === "client" ? "Yours" : viewer.name) : (known ?? name ?? "Unassigned");
    const g = groups.get(key) ?? { key, label, own, items: [] };
    g.items.push({ item, index });
    groups.set(key, g);
  });
  const all = [...groups.values()];
  return [...all.filter((g) => g.own), ...all.filter((g) => !g.own && g.key !== "unassigned"), ...all.filter((g) => g.key === "unassigned")];
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
