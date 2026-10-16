/**
 * On the horizon (H-385, plan H-387): what members see of what is coming. Four lists, each item with an area, a title and one
 * line in member language, a "You asked for this" pill, and Want this on the two lists members can vote on. Pure functions here:
 * the lists, the 30-day window for Just shipped, the area filter, the menu entries the items drive, and the notice selection.
 */

export const HORIZON_AREAS = ["Daily", "Grow", "Board", "Build", "HumanOS", "Coaching", "Everywhere"] as const;
export type HorizonArea = (typeof HORIZON_AREAS)[number];
export const HORIZON_CHIPS: readonly ("All" | Exclude<HorizonArea, "Everywhere">)[] = ["All", "Daily", "Grow", "Board", "Build", "HumanOS", "Coaching"];

export const HORIZON_STATUSES = ["shipped", "building", "next", "exploring"] as const;
export type HorizonStatus = (typeof HORIZON_STATUSES)[number];

/** The four lists, in page order. Members vote on the last two. */
export const HORIZON_LISTS: readonly { key: HorizonStatus; name: string; tab: string; sub: string; votable: boolean }[] = [
  { key: "shipped", name: "Just shipped", tab: "Shipped", sub: "Live in HelixOS now", votable: false },
  { key: "building", name: "Being built now", tab: "Building", sub: "In the workshop", votable: false },
  { key: "next", name: "Next up", tab: "Next up", sub: "Planned and queued", votable: true },
  { key: "exploring", name: "Exploring", tab: "Exploring", sub: "Tell us if you'd use it", votable: true },
];
export const VOTABLE: ReadonlySet<HorizonStatus> = new Set(HORIZON_LISTS.filter((l) => l.votable).map((l) => l.key));

/** Just shipped keeps an item for this long after it shipped; then it leaves the page and stays in the Shipped log. */
export const SHIPPED_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The menu entries an item can drive (one source for Coming soon, H-387): the key an item carries and the menu href it greys out until shipped. */
export const HORIZON_MENU_KEYS: readonly { key: string; href: string; label: string }[] = [{ key: "magic-funnel", href: "/magic-funnel", label: "Magic funnel" }];

export type HorizonItemLike = {
  id: string;
  title: string;
  line: string;
  area: HorizonArea;
  status: HorizonStatus;
  fromFeedback: boolean;
  sort: number;
  shippedAt: string | null;
  menuKey: string | null;
  hidden: boolean;
};

export function isArea(x: unknown): x is HorizonArea {
  return typeof x === "string" && (HORIZON_AREAS as readonly string[]).includes(x);
}
export function isStatus(x: unknown): x is HorizonStatus {
  return typeof x === "string" && (HORIZON_STATUSES as readonly string[]).includes(x);
}

/** Still inside the Just shipped window: shipped, with a shippedAt no older than SHIPPED_DAYS. */
export function shippedShows(item: Pick<HorizonItemLike, "status" | "shippedAt">, now: Date): boolean {
  if (item.status !== "shipped") return true;
  if (!item.shippedAt) return false;
  const t = new Date(item.shippedAt).getTime();
  return Number.isFinite(t) && now.getTime() - t <= SHIPPED_DAYS * DAY_MS;
}

/** What members see: not hidden, shipped ones inside their window, in sort order then newest first. */
export function visibleItems<T extends HorizonItemLike>(items: T[], now: Date): T[] {
  return items.filter((i) => !i.hidden && shippedShows(i, now)).sort((a, b) => a.sort - b.sort || b.id.localeCompare(a.id));
}

/** The area chips: Everywhere shows under every chip; All shows everything. */
export function inArea(item: Pick<HorizonItemLike, "area">, chip: string): boolean {
  return chip === "All" || item.area === chip || item.area === "Everywhere";
}

export function byList<T extends HorizonItemLike>(items: T[]): Record<HorizonStatus, T[]> {
  const out = { shipped: [], building: [], next: [], exploring: [] } as Record<HorizonStatus, T[]>;
  for (const i of items) out[i.status].push(i);
  return out;
}

/** The menu's Coming soon entries from the items: a key is "shipped" once the item carrying it has shipped (hidden or not). */
export function shippedMenuKeys(items: Pick<HorizonItemLike, "menuKey" | "status">[]): Set<string> {
  return new Set(items.filter((i) => i.menuKey && i.status === "shipped").map((i) => i.menuKey as string));
}

/** The one-time notice: an item the member wanted that has since shipped and has not been shown yet. The newest shipped first. */
export function shippedNotice<T extends HorizonItemLike>(items: T[], wants: { itemId: string; notifiedAt: string | null }[]): T | null {
  const wanted = new Map(wants.filter((w) => !w.notifiedAt).map((w) => [w.itemId, w]));
  const due = items.filter((i) => i.status === "shipped" && wanted.has(i.id)).sort((a, b) => (b.shippedAt ?? "").localeCompare(a.shippedAt ?? ""));
  return due[0] ?? null;
}

/** A form's fields, checked: title and line required and bounded, area and status from the lists, menu key from the known ones. */
export function parseHorizonForm(f: { title?: unknown; line?: unknown; area?: unknown; status?: unknown; fromFeedback?: unknown; menuKey?: unknown }): { ok: true; item: { title: string; line: string; area: HorizonArea; status: HorizonStatus; fromFeedback: boolean; menuKey: string | null } } | { ok: false; error: string } {
  const title = String(f.title ?? "").trim();
  const line = String(f.line ?? "").trim();
  if (!title || title.length > 80) return { ok: false, error: "Give it a title, up to 80 characters." };
  if (!line || line.length > 200) return { ok: false, error: "Give it one line, up to 200 characters." };
  if (!isArea(f.area)) return { ok: false, error: "Pick an area." };
  if (!isStatus(f.status)) return { ok: false, error: "Pick a list." };
  const menuKey = String(f.menuKey ?? "").trim();
  if (menuKey && !HORIZON_MENU_KEYS.some((k) => k.key === menuKey)) return { ok: false, error: "That menu entry isn't one the page can drive." };
  return { ok: true, item: { title, line, area: f.area, status: f.status, fromFeedback: f.fromFeedback === true || f.fromFeedback === "yes" || f.fromFeedback === "on", menuKey: menuKey || null } };
}

/** The first list: the mockup's items, in member language, with the three changes from H-385 and what is live already moved to Just shipped. */
export const HORIZON_SEED: Omit<HorizonItemLike, "id" | "hidden">[] = [
  { title: "Your streak counts weekends", line: "Every day you show up counts, Saturday and Sunday too, with a bonus for the weekend.", area: "Daily", status: "shipped", fromFeedback: false, sort: 10, shippedAt: "2026-10-14T00:00:00.000Z", menuKey: null },
  { title: "Setup first, with Start Here", line: "A Setup card on Today walks you through the first things to set up.", area: "Daily", status: "shipped", fromFeedback: false, sort: 20, shippedAt: "2026-10-13T00:00:00.000Z", menuKey: null },
  { title: "The Council Chamber's plaque and golden hour", line: "One short line on the table for each turn, the full answer below, and the Board's clips at golden hour.", area: "Board", status: "shipped", fromFeedback: false, sort: 30, shippedAt: "2026-10-16T00:00:00.000Z", menuKey: null },
  { title: "Your daily welcome", line: "A short welcome each time you show up: your fire streak, your points and today's coin.", area: "Daily", status: "shipped", fromFeedback: false, sort: 40, shippedAt: "2026-10-16T00:00:00.000Z", menuKey: null },
  { title: "The Colosseum", line: "Wins, ranks and challenges, with your seat in the stands, by night and by day.", area: "Grow", status: "shipped", fromFeedback: false, sort: 50, shippedAt: "2026-10-09T00:00:00.000Z", menuKey: null },
  { title: "The Aqueduct", line: "See where your leads flow, and where they leak.", area: "Grow", status: "shipped", fromFeedback: false, sort: 60, shippedAt: "2026-10-11T00:00:00.000Z", menuKey: null },
  { title: "My Helix", line: "Your progress at a glance.", area: "Daily", status: "shipped", fromFeedback: false, sort: 70, shippedAt: "2026-10-10T00:00:00.000Z", menuKey: null },
  { title: "The Forum", line: "Watch your AI agents at work.", area: "Build", status: "shipped", fromFeedback: false, sort: 80, shippedAt: "2026-10-12T00:00:00.000Z", menuKey: null },
  { title: "Building with AI", line: "A plain-English glossary, with help when you hover over a term.", area: "Build", status: "shipped", fromFeedback: true, sort: 90, shippedAt: "2026-10-12T00:00:00.000Z", menuKey: null },
  { title: "Prescriptions and refills", line: "Repeats, script expiry and a reminder when a refill opens.", area: "HumanOS", status: "shipped", fromFeedback: true, sort: 100, shippedAt: "2026-10-08T00:00:00.000Z", menuKey: null },
  { title: "Rank-up ceremonies", line: "Reach a new rank and watch its relic come to life in the Colosseum.", area: "Grow", status: "building", fromFeedback: false, sort: 110, shippedAt: null, menuKey: null },
  { title: "The HelixOS app", line: "HelixOS on your iPhone and Android, with only the notifications you choose.", area: "Everywhere", status: "building", fromFeedback: false, sort: 120, shippedAt: null, menuKey: null },
  { title: "A tidier menu", line: "Fold menu groups away on your phone, or collapse the whole menu in one tap.", area: "Everywhere", status: "building", fromFeedback: true, sort: 130, shippedAt: null, menuKey: null },
  { title: "Magic funnel", line: "A personal page for every webinar sign-up.", area: "Grow", status: "next", fromFeedback: false, sort: 140, shippedAt: null, menuKey: "magic-funnel" },
  { title: "Your units and currency", line: "Weights, measures and money shown the way your country uses them.", area: "Everywhere", status: "next", fromFeedback: true, sort: 150, shippedAt: null, menuKey: null },
  { title: "Spoken Board answers", line: "Hear your Board's recommendation read aloud.", area: "Board", status: "exploring", fromFeedback: false, sort: 160, shippedAt: null, menuKey: null },
  { title: "Shopping list to Instacart", line: "Send your HumanOS shopping list straight to your cart.", area: "HumanOS", status: "exploring", fromFeedback: false, sort: 170, shippedAt: null, menuKey: null },
  { title: "Your knowledge in your Board", line: "Point your Board at your own notes and courses, so its answers sound like you.", area: "Board", status: "exploring", fromFeedback: true, sort: 180, shippedAt: null, menuKey: null },
];
