/**
 * Objections: one record, the asset bank's `objection` type, read by the offer wizard, the webinar wizard, Socrates and the
 * Objections page. Pure helpers over that record: every reframe it carries, which belief it is about, and where it is already
 * handled. The belief vocabulary is the proof bank's (BELIEF_KEYS); "none" is a real answer.
 */
import type { BeliefKey } from "@/db/schema";
import method from "@/data/seed/socrates/objection-method.json";

export type ObjectionLike = { id: string; name: string; body: string; reframe: string | null; reframes: string[]; underneath: string | null; belief: BeliefKey | null; proof: string | null; useWhen: string | null; tag: string | null; workspaceId: string | null; userId: string | null };

/** The first reframe and the rest, as one list, blanks dropped. */
export function reframesOf(o: Pick<ObjectionLike, "reframe" | "reframes">): string[] {
  return [o.reframe ?? "", ...(o.reframes ?? [])].map((r) => r.trim()).filter(Boolean);
}

export const BELIEF_LABEL: Record<BeliefKey, string> = { vehicle: "Vehicle: does the method work at all", internal: "Internal: can I be the person who does this", external: "External: will it work in my circumstances", none: "Not a belief: decision avoidance, a different move" };

/** Shared with every client (the template's), or the client's own. */
export const isSharedObjection = (o: Pick<ObjectionLike, "workspaceId" | "userId">): boolean => o.workspaceId === null && o.userId === null;

/** Where an objection is already handled, derived and never stored: the webinar sections that took it and the offers that answer it. */
export function handledIn(o: Pick<ObjectionLike, "id">, sections: { assetId: string | null; name: string; webinarId: string }[], offers: { id: string; name: string; objectionAssetIds: string[] }[], webinarTitles: Map<string, string>): { kind: "webinar" | "offer"; label: string; href: string }[] {
  return [
    ...sections.filter((s) => s.assetId === o.id).map((s) => ({ kind: "webinar" as const, label: `${webinarTitles.get(s.webinarId) ?? "Webinar"} · ${s.name}`, href: `/webinars/${s.webinarId}?step=script` })),
    ...offers.filter((f) => f.objectionAssetIds.includes(o.id)).map((f) => ({ kind: "offer" as const, label: f.name, href: `/offers/${f.id}#objections` })),
  ];
}

/**
 * The handling method: a sequence, not a line. The steps are structure; their words are Danno's and arrive as data. Until
 * every step has its words the sequence is not shown, so nothing invented reaches a client.
 */
export type MethodStep = { key: string; title: string; line: string };
export const OBJECTION_METHOD: MethodStep[] = method as MethodStep[];
export const methodReady = (steps: MethodStep[] = OBJECTION_METHOD): boolean => steps.length > 0 && steps.every((s) => s.title.trim() && s.line.trim());
/** Step 5 ("Check it landed") sends you back to step 2 ("Find out what they actually mean") when it did not: the loop that makes this a method. */
export const LOOP_FROM = "check";
export const LOOP_TO = "find";
export const REFRAME_STEP_KEY = "reframe";

/** The offer wizard's older fixed fields, each with the objection it stood for, so a filled answer can move into the bank as a record. */
export const LEGACY_OFFER_OBJECTIONS: { field: "objTime" | "objMoney" | "objPartner" | "objTriedBefore" | "objDiy"; name: string }[] = [
  { field: "objTime", name: "I don't have time." },
  { field: "objMoney", name: "I don't have the money." },
  { field: "objPartner", name: "I need to ask my partner." },
  { field: "objTriedBefore", name: "I've tried this before." },
  { field: "objDiy", name: "I'll do it myself." },
];
