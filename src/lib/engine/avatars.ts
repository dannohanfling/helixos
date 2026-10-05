/**
 * Buyer avatars (rev 501, built by Body at rev 508): several per member, one level of sub-segments, linked many to many to
 * their offers with one main avatar per offer. Pure rules only; the reads and writes are in src/lib/avatars.ts.
 */
import { AVATAR_FIELDS, type AvatarField } from "@/db/schema";

export type AvatarRow = {
  id: string;
  parentId: string | null;
  name: string;
  oneLine: string | null;
  primary: boolean;
  imported: boolean;
  archivedAt: string | null;
  createdAt?: string;
} & { [K in AvatarField]: string | null };
export type LinkRow = { avatarId: string; offerId: string; main: boolean };
export type OfferRef = { id: string; name: string; avatar?: string | null; status?: string };

/** What the page asks for each field, in rev 501's words. */
export const AVATAR_FIELD_INFO: Record<AvatarField, { label: string; placeholder: string; short: string }> = {
  who: { label: "Who they are", short: "Who", placeholder: "Role, stage, situation. A coach two years in, fully booked 1:1, working evenings." },
  pains: { label: "Top pains or problems", short: "Pains", placeholder: "One per line, in plain words." },
  wants: { label: "What they want", short: "Wants", placeholder: "The outcome they'd pay for." },
  tried: { label: "What they've already tried", short: "Tried", placeholder: "Courses, hires, tools, the DIY version." },
  objections: { label: "Objections", short: "Objections", placeholder: "What they say before they say yes." },
  hangouts: { label: "Where they hang out", short: "Hangs out", placeholder: "Platforms, groups, podcasts, events." },
  phrases: { label: "The words they use", short: "Their words", placeholder: "Their own phrases, as they'd type them. One per line." },
  trigger: { label: "Buying trigger: why now", short: "Why now", placeholder: "What happens the week they decide." },
  framework: { label: "How your framework helps them", short: "How you help", placeholder: "Which part of your method fixes which pain." },
  notFor: { label: "Not for", short: "Not for", placeholder: "Who this avatar is not, so the copy can say so." },
};

export const IMPORTED_NOTE = "imported, please review";
const NAME_MAX = 60;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** An imported avatar's name: the free text's first words, cut at a word and with no trailing punctuation. */
export function importName(text: string): string {
  const t = clean(text);
  if (!t) return "Imported avatar";
  const first = t.split(/(?<=[.!?;:])\s|\s[–—-]\s/)[0] ?? t;
  const words = first.split(" ");
  let out = "";
  for (const w of words) {
    if ((out ? `${out} ${w}` : w).length > 40 || out.split(" ").length >= 7) break;
    out = out ? `${out} ${w}` : w;
  }
  out = (out || first.slice(0, 40)).replace(/[\s.,;:!?–—-]+$/, "");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * The first visit's import (rev 508): each distinct free-text avatar on the member's offers becomes one avatar marked imported,
 * linked to every offer that carried that text, as that offer's main. Distinct ignores case and spacing. Only when the member
 * has never had an avatar, so an archive or a delete is never undone by a later visit. The text stays on the offer.
 */
export function importPlan(offers: OfferRef[], hadAvatars: boolean): { name: string; who: string; offerIds: string[] }[] {
  if (hadAvatars) return [];
  const byText = new Map<string, { name: string; who: string; offerIds: string[] }>();
  for (const o of offers) {
    const t = clean(o.avatar);
    if (!t) continue;
    const key = t.toLowerCase();
    const at = byText.get(key);
    if (at) at.offerIds.push(o.id);
    else byText.set(key, { name: importName(t), who: (o.avatar ?? "").trim(), offerIds: [o.id] });
  }
  return [...byText.values()];
}

export type AvatarNode = { avatar: AvatarRow; children: AvatarRow[] };

/**
 * The page's cards: top-level avatars, the Primary first and then by when they were made, each with its sub-segments.
 * A sub-segment whose parent is archived or gone stands on its own rather than vanish. Archived ones are left out.
 */
export function avatarTree(rows: AvatarRow[]): AvatarNode[] {
  const live = rows.filter((a) => !a.archivedAt);
  const ids = new Set(live.map((a) => a.id));
  const order = (a: AvatarRow, b: AvatarRow) => Number(b.primary) - Number(a.primary) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.name.localeCompare(b.name);
  const tops = live.filter((a) => !a.parentId || !ids.has(a.parentId)).sort(order);
  return tops.map((avatar) => ({ avatar, children: live.filter((c) => c.parentId === avatar.id).sort(order) }));
}

/** Why a parent can't be used, or null: itself, a sub-segment (one level only), or a parent for one that has its own. */
export function parentProblem(rows: AvatarRow[], id: string | null, parentId: string | null): string | null {
  if (!parentId) return null;
  if (parentId === id) return "An avatar can't be a sub-segment of itself.";
  const parent = rows.find((a) => a.id === parentId && !a.archivedAt);
  if (!parent) return "That avatar isn't there any more.";
  if (parent.parentId) return `"${parent.name}" is a sub-segment already; pick its parent instead.`;
  if (id && rows.some((a) => a.parentId === id && !a.archivedAt)) return "This avatar has sub-segments of its own, so it stays top-level.";
  return null;
}

/** A copy's name: "Name (copy)", then "(copy 2)" and on, never the same as one that's there. */
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/\s*\(copy(?: \d+)?\)$/, "");
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const c = `${base} (copy${n > 1 ? ` ${n}` : ""})`;
    if (!lower.has(c.toLowerCase())) return c.slice(0, NAME_MAX + 12);
  }
}

/** The offers an avatar is linked to, by name in the offers' own order; and the avatars an offer is for, main first. */
export function offersOf(avatarId: string, links: LinkRow[], offers: OfferRef[]): (OfferRef & { main: boolean })[] {
  return offers.flatMap((o) => {
    const l = links.find((x) => x.avatarId === avatarId && x.offerId === o.id);
    return l ? [{ ...o, main: l.main }] : [];
  });
}
export function avatarsOf(offerId: string, links: LinkRow[], rows: AvatarRow[]): (AvatarRow & { main: boolean })[] {
  return links
    .filter((l) => l.offerId === offerId)
    .flatMap((l) => {
      const a = rows.find((x) => x.id === l.avatarId && !x.archivedAt);
      return a ? [{ ...a, main: l.main }] : [];
    })
    .sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
}

/** The avatar a draft for this offer writes to: the offer's main, else its only one, else the member's Primary; null when none. */
export function avatarForDraft(rows: AvatarRow[], links: LinkRow[], offerId: string | null | undefined): AvatarRow | null {
  if (offerId) {
    const mine = avatarsOf(offerId, links, rows);
    const main = mine.find((a) => a.main) ?? (mine.length === 1 ? mine[0] : null);
    if (main) return main;
  }
  return rows.find((a) => a.primary && !a.archivedAt) ?? null;
}

const lines = (s: string | null) =>
  (s ?? "")
    .split(/\n+/)
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
    .filter(Boolean);

/**
 * The avatar as a drafter reads it: only the fields that are filled, each in the member's own words, under a rule that
 * nothing is added. Empty when nothing past the name is filled, so a prompt never carries a bare name as if it were a person.
 */
export function avatarBrief(a: AvatarRow | null, parent?: AvatarRow | null): string {
  if (!a) return "";
  const filled = AVATAR_FIELDS.filter((f) => clean(a[f]));
  if (!filled.length && !clean(a.oneLine)) return "";
  const head = `WHO IT'S FOR: the member's own buyer avatar "${a.name}"${parent ? `, a sub-segment of "${parent.name}"` : ""}. Use only what is written here, in these words where they fit; never invent a pain, a number, a quote or a result.`;
  const body = [
    clean(a.oneLine) ? `In one line: ${clean(a.oneLine)}` : "",
    ...filled.map((f) => {
      const ls = lines(a[f]);
      return ls.length > 1 ? `${AVATAR_FIELD_INFO[f].label}:\n${ls.map((l) => `- ${l}`).join("\n")}` : `${AVATAR_FIELD_INFO[f].label}: ${ls[0] ?? ""}`;
    }),
  ].filter(Boolean);
  return [head, ...body].join("\n");
}

/** The webinar and deck "Who it is for" off an avatar, for an offer whose own lines are empty: who they are, and not for. */
export function fitFromAvatar(a: AvatarRow | null): { forYouIf: string | null; notForYouIf: string | null } {
  return { forYouIf: clean(a?.who) || clean(a?.oneLine) || null, notForYouIf: clean(a?.notFor) || null };
}

/** The coach page's line (rev 501 §7): "3 avatars · 2 offers linked". Archived avatars aren't counted. */
export function coachLine(rows: AvatarRow[], links: LinkRow[]): string {
  const live = new Set(rows.filter((a) => !a.archivedAt).map((a) => a.id));
  const offers = new Set(links.filter((l) => live.has(l.avatarId)).map((l) => l.offerId));
  return `${live.size} avatar${live.size === 1 ? "" : "s"} · ${offers.size} offer${offers.size === 1 ? "" : "s"} linked`;
}

/** How much of an avatar is written: n of the ten fields. */
export const filledCount = (a: AvatarRow) => AVATAR_FIELDS.filter((f) => clean(a[f])).length;
