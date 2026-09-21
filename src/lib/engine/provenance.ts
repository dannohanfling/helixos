/**
 * The provenance mark on AI drafts, pure. A model's text is stored as `ai_unreviewed` the moment it returns; it becomes
 * `ai_accepted` on an explicit Accept (one item at a time, never all at once) or `edited` on any coach edit, since an edit
 * counts as review. Coach-written text is `coach`; text a rule composed from what the coach chose is `rule`, never gated. A
 * row from before the mark is null: never guessed, never flagged. Only `ai_unreviewed` is ever gated, and the gate stands on the action that sends content out,
 * never on the page: the action names the drafts and offers Review or Continue anyway; Continue anyway is logged with who
 * and when. Nothing here reads the database; the actions and pages call in with what the record holds.
 */
import type { Origin } from "@/db/schema";
import { CHANNEL_SPECS } from "@/lib/engine/repurpose";

/** The label beside an unreviewed draft in its editor, and the three choices; wording from the ruling, not this code. */
export const UNREVIEWED_LABEL = "AI draft, not reviewed";
export const ACCEPT_LABEL = "Accept";
export const REVIEW_LABEL = "Review";
export const CONTINUE_LABEL = "Continue anyway";

export const isUnreviewed = (origin: string | null | undefined): boolean => origin === "ai_unreviewed";

/**
 * The origin after a coach saves a text field. Unchanged text leaves the mark alone: saving a duration does not review a
 * script. Changed text is the coach's review: an AI draft (unreviewed, accepted or already edited) becomes `edited`; a
 * coach's own text, or text with no known origin, becomes `coach` because the coach chose the words now on the record.
 */
/** The same words: a form submits a textarea with CRLF line breaks and the record holds LF, and neither is an edit. */
export const sameText = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? "").replace(/\r\n/g, "\n").trim() === (b ?? "").replace(/\r\n/g, "\n").trim();

export function originAfterSave(current: Origin | null | undefined, before: string | null | undefined, after: string | null | undefined): Origin | null {
  if (sameText(before, after)) return current ?? null;
  if (current === "ai_unreviewed" || current === "ai_accepted" || current === "edited") return "edited";
  return "coach";
}

/** Accept moves one unreviewed draft to accepted and touches nothing else: an accept on an edited or coach row is a no-op. */
export const originAfterAccept = (current: Origin | null | undefined): Origin | null => (current === "ai_unreviewed" ? "ai_accepted" : (current ?? null));

/** The run sheet's count at the top: how many scripts are a model's draft nobody has read, and which. One reads in the singular. */
export const unreviewedCountLine = (names: readonly string[]): string => `${names.length} ${names.length === 1 ? "AI draft" : "AI drafts"}, not reviewed: ${names.join(", ")}`;

/** The gate's first line, from the ruling: "N items are AI drafts you haven't reviewed". One item reads in the singular. */
export function gateLine(count: number): string {
  return count === 1 ? "1 item is an AI draft you haven't reviewed" : `${count} items are AI drafts you haven't reviewed`;
}

/** What an action that sends content out has to show before it goes: the drafts it would carry, by name, or nothing. */
export type Gate = { line: string; items: string[] };

/** The gate over a set of named records: the unreviewed ones, in the order given, or null when every one has been read. */
export function gateFor(rows: { name: string; origin: string | null | undefined }[]): Gate | null {
  const items = rows.filter((r) => isUnreviewed(r.origin)).map((r) => r.name);
  return items.length ? { line: gateLine(items.length), items } : null;
}

/**
 * A text field the coach is sending as it stands: unreviewed only while the stored draft is still the text going out. Text
 * that differs from the stored draft has been rewritten on the way, and the rewrite is the review.
 */
export const carriesUnreviewed = (origin: string | null | undefined, stored: string | null | undefined, going: string | null | undefined): boolean => isUnreviewed(origin) && sameText(stored, going);

/** The deck export's gate: every section the deck could carry (a section left out on purpose is not sent anywhere). */
export const sectionGate = (sections: { name: string; status: string; origin: string | null | undefined }[]): Gate | null => gateFor(sections.filter((s) => s.status !== "omitted"));

/** How a variant is named in a gate's line: the group it was drafted for, else its channel's label. */
export const variantName = (v: { channel: string; groupId: string }, groupName?: string | null): string => (v.groupId ? (groupName ?? "a group post") : (CHANNEL_SPECS.find((c) => c.key === v.channel)?.label ?? v.channel));

/** A confirm covers the drafts it named and no others: the same names, in any order, and nothing added since. */
export const sameItems = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
