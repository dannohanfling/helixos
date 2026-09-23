/**
 * HelixOS → Community Loyalty (uChat) bot fields, the pure part: which of the template's ten names the Stage 1 push writes,
 * which names it must never touch because the client or the bot's own agent writes them, and how each value is composed
 * from the record. The push is a named subset, never "all fields": a re-push after an unrelated edit must leave the calendar
 * the client chose and the appointment the agent booked exactly as they were. (code-essence-to-botfields.md §2.3, §3a.)
 */
import { formatPrice } from "./offer-score";
import { agentReadsFields, notReadWarning, type AgentInfo } from "./faq";

/**
 * The offers field, by the template's current name, and the name bots made before the rename still carry. The push writes the
 * new name when the bot has it and falls back to the old one only when it has no field by the new name; the Coach page and the
 * preview name the fallback whenever it is in use.
 */
export const PRODUCT_FIELD = "ai_product_&_service_information_cbf";
export const PRODUCT_FIELD_OLD = "ai_product_&_service_cbf";

/** The Book 'em Danno template's ten custom bot fields, read in Third Eye on 20 Sep, the offers field by its current name. The prompts reference these names. */
export const TEMPLATE_BOT_FIELDS = ["business_name_cbf", "business_time_zone_cbf", PRODUCT_FIELD, "ai_persona_role_cbf", "ai_skills_cbf", "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3", "calendar_id"] as const;

/** Stage 1: facts with one right answer, plus the house constraints block and the three qualifying questions with their defaults. */
export const STAGE1_FIELDS = ["business_name_cbf", "business_time_zone_cbf", PRODUCT_FIELD, "ai_constraints_cbf", "qualifying_question_1", "qualifying_question_2", "qualifying_question_3"] as const;
export type Stage1Field = (typeof STAGE1_FIELDS)[number];
/** A Stage 1 field's older name, tried only when the bot has no field by the current one. */
export const FIELD_FALLBACKS: Partial<Record<Stage1Field, string>> = { [PRODUCT_FIELD]: PRODUCT_FIELD_OLD };

/**
 * Written on the Community Loyalty side and never by this push: the calendar the client chose during Book 'em Danno onboarding,
 * and what the agent writes when it books. The last two are the agent's names as reported (21 Sep); confirm against the template.
 */
export const BOT_WRITTEN_FIELDS = ["calendar_id", "appointment_id", "booked_time"] as const;

/** Stage 2, held until the Essence intake stops handing clients somebody else's words: paragraphs of the client's voice. */
export const STAGE2_FIELDS = ["ai_persona_role_cbf", "ai_skills_cbf"] as const;

for (const f of STAGE1_FIELDS) if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(f)) throw new Error(`bot-fields: ${f} is written by the bot and cannot be pushed`);

/**
 * The house default for ai_constraints_cbf: the claims discipline, shipped to every client bot so nothing ships with the brakes
 * off. The client's own prohibitions and ethics are appended when Stage 2 ships. Provisional wording, on the sentence list.
 */
export const HOUSE_CONSTRAINT_LINES = [
  "Never invent a statistic, a result or a testimonial. If a number is not in your fields, you do not have it.",
  "Never state a price, a discount or a payment plan that is not in your product and service field.",
  "Never claim a client's result without the number and the permission to say it.",
  "Never promise a booking before it is confirmed. Say you are booking it, then say it is booked only when it is.",
  "When you do not know, say so and offer the next step. Never guess a deadline, a policy or a medical, legal or financial answer.",
  "If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be {business_name_cbf}.",
];
/** The block with the business name written in: a bot field's value is plain text, so the name is filled here, not by the bot. No name, no block: the push refuses instead. */
export const houseConstraints = (businessName: string): string => HOUSE_CONSTRAINT_LINES.map((l) => l.replace("{business_name_cbf}", businessName.trim())).join("\n");

/** Why a Stage 1 payload cannot go: a fact with no value is a gap in the record, not a sentence to ship around. */
export function stage1Problems(p: BotFieldPayload): string[] {
  return p.business_name_cbf.trim() ? [] : ["No business name on the record: set it on the member's profile or the workspace."];
}

/** Provisional questions the bot asks before booking, until the coach writes their own on the Offer. On the sentence list. */
export const QUALIFYING_DEFAULTS: [string, string, string] = [
  "What are you working towards right now, in a sentence?",
  "What have you already tried, and what happened?",
  "If we found a fit, when would you want to start?",
];

export type OfferFacts = { name: string; promise: string | null; container: string; price: number; currency: string; length: string | null; status: string; neverQuotePrice?: boolean | null; qualifyingQuestion1?: string | null; qualifyingQuestion2?: string | null; qualifyingQuestion3?: string | null };
export type Stage1Input = { businessName: string | null | undefined; workspaceName: string; timezone: string; offers: OfferFacts[] };
export type BotFieldPayload = Record<Stage1Field, string>;

/**
 * One line per live offer, facts only: name, promise, container, price with currency, length. Never a paragraph from the Essence.
 * An offer ticked "never quote prices" goes without its price: the house constraints already forbid a price that is not in this
 * field, so leaving it out is what keeps the bot from stating one.
 */
export function productLine(o: OfferFacts): string {
  return [o.name, o.promise?.trim() || "", o.container, o.neverQuotePrice ? "" : formatPrice(o.price, o.currency), o.length?.trim() || ""].filter(Boolean).join(" · ");
}
/** The live offers whose price is left out of what the bot is sent, by name, for the Brief and the preview to say so. */
export const pricesLeftOut = (offers: OfferFacts[]): string[] => offers.filter((o) => o.status === "live" && o.neverQuotePrice).map((o) => o.name);

/** The three questions: the live offer's own when written, the house default when not. */
export function qualifyingQuestions(o: OfferFacts | undefined): [string, string, string] {
  return [o?.qualifyingQuestion1?.trim() || QUALIFYING_DEFAULTS[0], o?.qualifyingQuestion2?.trim() || QUALIFYING_DEFAULTS[1], o?.qualifyingQuestion3?.trim() || QUALIFYING_DEFAULTS[2]];
}

/**
 * The Stage 1 payload: exactly STAGE1_FIELDS, every one present, composed from the record. A source the client has not filled
 * composes empty here, and the plan leaves it out of what is sent: Community Loyalty refuses an empty value (422, "The
 * data.0.value field is required."), and the bot keeps what it holds.
 */
export function stage1Payload(input: Stage1Input): BotFieldPayload {
  const live = input.offers.filter((o) => o.status === "live");
  const [q1, q2, q3] = qualifyingQuestions(live[0]);
  const businessName = (input.businessName ?? "").trim() || input.workspaceName.trim();
  return {
    business_name_cbf: businessName,
    business_time_zone_cbf: input.timezone,
    [PRODUCT_FIELD]: live.map(productLine).join("\n"),
    ai_constraints_cbf: houseConstraints(businessName),
    qualifying_question_1: q1,
    qualifying_question_2: q2,
    qualifying_question_3: q3,
  };
}

/** Nothing has changed since the last push: the bot already holds exactly this. */
export function samePayload(last: Record<string, string> | null | undefined, next: BotFieldPayload): boolean {
  if (!last) return false;
  const keys = Object.keys(next) as Stage1Field[];
  return Object.keys(last).length === keys.length && keys.every((k) => last[k] === next[k]);
}

/**
 * What a field says when HelixOS wrote it and now has nothing for it: the offer retired, the question removed. Leaving the field
 * out would leave the bot selling the retired offer, so the field is told there is none, in words an agent reading it mid-prompt
 * acts on safely. Only a value HelixOS itself last sent is replaced this way; text anyone else wrote is left out, as before.
 * Proposed wording, on the sentence list: Danno or Claude may reword any of these here, and nothing else needs to change,
 * because every check compares against this table.
 */
export const STAGE1_NOTHING_CURRENT: Record<Stage1Field, string> = {
  business_name_cbf: "No business name is set. Do not name a business; say you are an assistant and offer a call with the coach.",
  business_time_zone_cbf: "No time zone is set. Do not state a time without saying which time zone it is in.",
  [PRODUCT_FIELD]: "There is no offer open right now. Do not describe or price any product; offer a call with the coach instead.",
  ai_constraints_cbf: "No extra rules are set. Never invent a statistic, a result, a price or a testimonial.",
  qualifying_question_1: "No question set.",
  qualifying_question_2: "No question set.",
  qualifying_question_3: "No question set.",
} as Record<Stage1Field, string>;
/** A field holding exactly its nothing-current sentence is HelixOS's own empty: never foreign text, and the next real value goes straight over it. */
export const isNothingCurrent = (field: Stage1Field, held: string | null | undefined): boolean => (held ?? "").trim() === STAGE1_NOTHING_CURRENT[field];
/** How the Brief and the preview say it, never quoting the sentence back. */
export const NOTHING_CURRENT_LABEL: Record<Stage1Field, string> = {
  business_name_cbf: "No business name",
  business_time_zone_cbf: "No time zone",
  [PRODUCT_FIELD]: "No current offer",
  ai_constraints_cbf: "No extra rules",
  qualifying_question_1: "No question set",
  qualifying_question_2: "No question set",
  qualifying_question_3: "No question set",
} as Record<Stage1Field, string>;

/**
 * What a Stage 1 push would do on one bot, field by field, before anything is sent (the ruling of 21 Sep: "Before any Stage 1
 * push, show the coach what will change on the bot: current value against new value, per field"). Each field resolves to the
 * name the bot actually has (the current one, else its older name). Bot fields belong to the whole bot, so a field is read when
 * any agent on the bot reads it (23 Sep: the FAQ agent reads only the FAQ field; the business facts are read by another agent on
 * the same bot), through the same id-aware check the FAQ uses, and each row names the agents that read it. Then:
 * - missing: the bot has no field by either name, so there is nothing to write into;
 * - unread: no agent on the bot reads it, so it gets the plain line and is not sent, and its values are not shown;
 * - empty: HelixOS has nothing for it and the bot holds text HelixOS did not last send, so it is left out rather than sent as ""
 *   and the bot keeps what it holds;
 * - same: the bot already holds exactly this (or already says there is none);
 * - change: sent, with the bot's current value beside the new one. That includes a field HelixOS last wrote and now has nothing
 *   for: it is sent its nothing-current sentence (`nothing` is set), so a retired offer stops being sold.
 * Only "change" rows are sent, and the read-back covers only those. `lastSent` is what HelixOS last confirmed on this bot, by name.
 */
export type PlanStatus = "change" | "same" | "empty" | "missing" | "unread";
export type PlanRow = { field: Stage1Field; name: string | null; fallback: boolean; current: string | null; next: string; status: PlanStatus; line: string; readBy: string[]; nothing: boolean };
export function stage1Plan(payload: BotFieldPayload, held: { name: string; value: string; ns: string }[], agents: AgentInfo[], lastSent: Record<string, string> = {}): PlanRow[] {
  const byName = new Map(held.map((h) => [h.name, h]));
  const nsByName = Object.fromEntries(held.filter((h) => h.ns).map((h) => [h.name, h.ns]));
  return STAGE1_FIELDS.map((field) => {
    const older = FIELD_FALLBACKS[field];
    const name = byName.has(field) ? field : older && byName.has(older) ? older : null;
    const fallback = Boolean(name && name !== field);
    const readBy = name ? agents.filter((a) => agentReadsFields(a, [name], nsByName).reads.length).map((a) => a.name) : [];
    const current = name ? (byName.get(name)?.value ?? null) : null;
    const row = { field, name, fallback, current, next: payload[field], readBy, nothing: false };
    const written = fallback ? `Written to ${name}, this bot's older name for ${field}.` : "";
    if (!name) return { ...row, status: "missing" as const, line: `Your bot has no ${field} field${older ? ` (nor the older ${older})` : ""}, so nothing is sent to it.` };
    if (!readBy.length) return { ...row, current: null, next: "", status: "unread" as const, line: `${notReadWarning(name)[0].toUpperCase()}${notReadWarning(name).slice(1)}, so nothing is sent to it.` };
    if (!row.next.trim()) {
      const sentence = STAGE1_NOTHING_CURRENT[field];
      if (isNothingCurrent(field, current)) return { ...row, next: sentence, nothing: true, status: "same" as const, line: `Your bot already says: ${NOTHING_CURRENT_LABEL[field].toLowerCase()}.` };
      const ours = Boolean(current?.trim()) && current === lastSent[name];
      if (ours) return { ...row, next: sentence, nothing: true, status: "change" as const, line: `HelixOS wrote this and now has nothing for it, so your bot is told: ${NOTHING_CURRENT_LABEL[field].toLowerCase()}.${written ? ` ${written}` : ""}` };
      return { ...row, status: "empty" as const, line: "HelixOS has nothing for this yet, and your bot holds text HelixOS did not send, so nothing is sent; your bot keeps what it holds." };
    }
    if (current === row.next) return { ...row, status: "same" as const, line: "Your bot already holds this." };
    return { ...row, status: "change" as const, line: written };
  });
}

/**
 * The line under a plan with nothing to send, counted from the five states rather than one blanket sentence (23 Sep: "the bot
 * already holds everything" was shown when no agent read any field).
 */
export function nothingToPushLine(rows: PlanRow[]): string {
  const n = (s: PlanStatus) => rows.filter((r) => r.status === s).length;
  if (rows.length && n("unread") === rows.length) return "Nothing to push: no agent on this bot reads these fields yet.";
  if (rows.length && n("same") === rows.length) return "Nothing to push: the bot already holds everything HelixOS would send.";
  const parts = [
    [n("same"), "unchanged"],
    [n("unread"), "not read by any agent"],
    [n("empty"), "with nothing in HelixOS"],
    [n("missing"), "not on the bot"],
  ] as const;
  return `Nothing to push: ${parts.filter(([c]) => c).map(([c, w]) => `${c} ${w}`).join(", ")}.`;
}

/** The fields a plan sends, by the name on the bot, with the new value: only the ones that change. */
export const planPayload = (rows: PlanRow[]): Record<string, string> => Object.fromEntries(rows.filter((r) => r.status === "change" && r.name && r.next.trim()).map((r) => [r.name as string, r.next]));

/**
 * The record of what was pushed holds field names and values from the business record and nothing from the transport. A value
 * that carries the token or a webhook address is a bug upstream, so it refuses rather than stores.
 */
export function assertStorable(payload: Record<string, string>, forbidden: string[]): void {
  const marks = [...forbidden.filter(Boolean), "/api/iwh/", "/api/webhooks/"];
  for (const [k, v] of Object.entries(payload)) for (const m of marks) if (v.includes(m)) throw new Error(`bot-fields: ${k} carries a credential and cannot be pushed or stored`);
}

/**
 * The request body for PUT /flow/set-bot-fields-by-name, read off the published UChat API OpenAPI document (1.0.0), quoted in
 * code-addendum-uchat-spec.md: `{ "data": [ { "name": string, "value": string } ] }`, `data` required, "up to 20 bot fields".
 * Every value is a string, serialised deliberately here (a business name, an IANA zone name, newline-joined lines, three
 * questions), and more than the spec's limit refuses loudly rather than truncating.
 */
export const MAX_BOT_FIELDS_PER_CALL = 20;
export type BotFieldsRequest = { data: { name: string; value: string }[] };
export function botFieldsRequest(payload: Record<string, string>): BotFieldsRequest {
  const data = Object.entries(payload).map(([name, value]) => {
    if (typeof value !== "string") throw new Error(`bot-fields: ${name} is not a string and cannot be pushed as one`);
    return { name, value };
  });
  if (data.length > MAX_BOT_FIELDS_PER_CALL) throw new Error(`bot-fields: ${data.length} fields in one call; the API takes ${MAX_BOT_FIELDS_PER_CALL}`);
  if (!data.length) throw new Error("bot-fields: nothing to push");
  return { data };
}

/**
 * A 200 from the push is `{ "status": "ok" }` and carries no per-field result, so it does not prove a field was written. The
 * read-back compares what the bot now holds against what was sent: the names whose value differs or is missing.
 */
export function readBackMismatches(sent: Record<string, string>, held: Record<string, string | undefined>): string[] {
  return Object.keys(sent).filter((k) => held[k] !== sent[k]);
}

/**
 * GET /flow/bot-fields answers BotFieldResource, `{ "data": [ BotField ] }`, where BotField requires `name`, `var_type` and
 * `value` (a string) and takes `limit` and `page` (1 to 100) with no total. One shape is parsed and nothing else: a body that
 * is not that shape is nothing held, which fails the match on the safe side. Pages are read until one comes back shorter
 * than the limit sent.
 */
export const READ_BACK_LIMIT = 100;
export const BOT_FIELD_TYPES = ["text", "number", "boolean", "date", "datetime", "array", "longtext"] as const;
export function parseBotFields(body: unknown): { name: string; value: string; varType: string; ns: string }[] {
  const b = body as { data?: unknown };
  if (!b || typeof b !== "object" || !Array.isArray(b.data)) return [];
  const out: { name: string; value: string; varType: string; ns: string }[] = [];
  for (const r of b.data as { name?: unknown; var_type?: unknown; value?: unknown; var_ns?: unknown }[]) {
    if (typeof r?.name !== "string" || typeof r.var_type !== "string" || typeof r.value !== "string") continue;
    // var_ns is the field's variable id: what a prompt's chip stores in place of the name, so the agent-reads check looks for it.
    out.push({ name: r.name, value: r.value, varType: r.var_type, ns: typeof r.var_ns === "string" ? r.var_ns : "" });
  }
  return out;
}
/** Another page follows only while a page came back full. */
export const morePages = (received: number, limit: number): boolean => received >= limit;
