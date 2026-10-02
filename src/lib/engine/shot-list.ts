/**
 * "Pictures to gather" (deck visuals brief §6.3): the outline's picture slots as a list a client works through while they write,
 * grouped by what kind of picture each wants, each naming the slide it serves, with a count. A slot the coach said they don't
 * have is dropped: it leaves the count and its slide exports as text with no placeholder. The logo is one more line, gathered
 * when the kit or the library has one. Pure: the page, the Deck step and Today all read this.
 */
import type { SlotKind } from "./deck";

export type ShotGroup = "photos" | "screenshots" | "proof" | "diagrams";
export const SHOT_GROUPS: { group: ShotGroup; label: string }[] = [
  { group: "photos", label: "Photos of you" },
  { group: "screenshots", label: "Screenshots of results" },
  { group: "proof", label: "Proof" },
  { group: "diagrams", label: "Diagrams" },
];
export const shotGroupOf = (kind: SlotKind): ShotGroup => (kind === "screenshot" || kind === "screenshot_callout" ? "screenshots" : kind === "proof_wall" || kind === "testimonial" ? "proof" : kind === "diagram" ? "diagrams" : "photos");

export type ShotState = "gathered" | "missing" | "dropped";
export type ShotItem = { key: string; group: ShotGroup; what: string; slide: number; section: string; state: ShotState; /** A testimonial draws from the Proof Bank, never from an upload. */ testimonial: boolean };
export type ShotListInput = { slide: number; section: string; slot: { key: string; kind: SlotKind; what: string }; image: unknown | null; dropped: boolean };
export type ShotList = { items: ShotItem[]; groups: { group: ShotGroup; label: string; items: ShotItem[] }[]; logo: boolean; gathered: number; total: number; dropped: number; done: boolean };

export function shotList(resolved: ShotListInput[], hasLogo: boolean): ShotList {
  const items: ShotItem[] = resolved.map((r) => ({
    key: r.slot.key,
    group: shotGroupOf(r.slot.kind),
    what: r.slot.what,
    slide: r.slide,
    section: r.section,
    state: r.dropped ? "dropped" : r.image ? "gathered" : "missing",
    testimonial: r.slot.kind === "testimonial",
  }));
  const groups = SHOT_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.group) })).filter((g) => g.items.length);
  const counted = items.filter((i) => i.state !== "dropped");
  const total = counted.length + 1; // the logo
  const gathered = counted.filter((i) => i.state === "gathered").length + (hasLogo ? 1 : 0);
  return { items, groups, logo: hasLogo, gathered, total, dropped: items.length - counted.length, done: gathered >= total };
}

/** The one line: "5 of 14 gathered". */
export const shotCountLine = (l: Pick<ShotList, "gathered" | "total">): string => `${l.gathered} of ${l.total} gathered`;
