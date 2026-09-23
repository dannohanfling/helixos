/**
 * The coach's brain, the pure part: the Knowledge Base Builder format parsed deterministically (no model), the rule that
 * pins an answer to "Needs your eyes", the rank a push follows, the one text field the approved answers compose into under
 * a single budget (whole entries dropped past it and listed), the diff since the last sync, and which bot-field tokens the
 * target agent's prompt actually reads. Nothing here reads the database or calls the network; the actions and the client
 * call in with what the record and the platform hold.
 */
import { FAQ_CATEGORIES } from "@/db/schema";

/**
 * The single limit on the composed field, in characters, named on the Brief. 20,000 is the platform's own cap, confirmed on Danno's
 * bot (its Error Logs: "Data size is over 20000 characters"; the prompt section counters read "/ 20000"). Community Loyalty
 * offers bot fields in one type only, Text, and never lets a field's type change, so the budget is the whole of it: no type to ask for.
 */
export const FAQ_FIELD_BUDGET = 20000;
/**
 * What the FAQ field holds when no answer is approved. Community Loyalty will not hold an empty bot field through
 * set-bot-fields-by-name, by any spelling of empty (Danno's bot, 22 Sep 18:11 PDT):
 *   [cl.http] PUT /flow/set-bot-fields-by-name (faq, empty) 422 {"message":"The data.0.value field is required."}
 *   [cl.http] PUT /flow/set-bot-fields-by-name (faq, a single space) 422 {"message":"The data.0.value field is required."}
 * The field is read by a model mid-prompt ("Approved answers from HelixOS are below…"), so it gets a sentence that keeps the
 * prompt true and lets the agent fall through to the knowledge base, not a sentinel it might try to interpret. The published
 * spec as far as it has been read (set-bot-fields-by-name) offers no call that clears a bot field. This is the design.
 */
export const FAQ_EMPTY_VALUE = "There are no approved answers yet.";
/** What the Brief says after that send, so the next coach who finds a sentence in the field in Community Loyalty knows why. */
export const FAQ_EMPTY_SENT = "Your bot's FAQ field now says there are no approved answers yet. Community Loyalty doesn't allow an empty field.";
/** A field holding exactly the empty value is HelixOS's own, holding nothing. */
export const isFaqEmptyValue = (held: string | null | undefined): boolean => (held ?? "").trim() === FAQ_EMPTY_VALUE;
/** The value a composed field is written as: the answers, or the empty value when there are none. */
export const faqFieldValue = (composedText: string): string => composedText || FAQ_EMPTY_VALUE;
/**
 * The one bot field the approved answers go to: a field dedicated to the FAQ and written only by HelixOS. Never the Booking
 * Agent's Product & Service Information field, which already holds the coach's offer description — a push there would erase it,
 * and that agent only books; the agent that answers questions is the one whose prompt must carry this token. Overridable per
 * member on the Coach page, within the refusals below.
 */
export const FAQ_BOT_FIELD_DEFAULT = "ai_faq_cbf";

export type ParsedEntry = { question: string; alsoAsked: string[]; keywords: string[]; answer: string; category: string };
export type ParsedKnowledgeBase = { header: string; entries: ParsedEntry[] };

const ENTRY_MARK = /^###\s*Q:\s*/i;
const LABELS: { key: keyof ParsedEntry; re: RegExp }[] = [
  { key: "alsoAsked", re: /^\**\s*also asked\s*:?\s*\**\s*:?\s*/i },
  { key: "keywords", re: /^\**\s*keywords\s*:?\s*\**\s*:?\s*/i },
  { key: "answer", re: /^\**\s*answer\s*:?\s*\**\s*:?\s*/i },
  { key: "category", re: /^\**\s*category\s*:?\s*\**\s*:?\s*/i },
];
/** The separators the template's own output uses between variants and keywords: a comma, a semicolon, a newline, a slash or a pipe. */
const splitList = (s: string): string[] => s.split(/[,;\n|]|\s\/\s/).map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

/**
 * The template's exact format, parsed line by line: an entry opens at `### Q:`, and inside it `Also asked:`, `Keywords:`,
 * `Answer:` and `Category:` label the rest, with or without the template's bold markers, in any case. An answer runs until the
 * next label or entry. Everything before the first `### Q:` is the header block, kept whole and never an entry. An entry with
 * no question or no answer is not an entry. Deterministic: the same text always gives the same entries.
 */
export function parseKnowledgeBase(text: string): ParsedKnowledgeBase {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headerLines: string[] = [];
  const entries: ParsedEntry[] = [];
  let cur: ParsedEntry | null = null;
  let field: keyof ParsedEntry | null = null;
  const push = () => {
    if (cur && cur.question.trim() && cur.answer.trim()) entries.push({ ...cur, question: cur.question.trim(), answer: cur.answer.trim(), category: cur.category.trim() });
    cur = null;
    field = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (ENTRY_MARK.test(line)) {
      push();
      cur = { question: line.replace(ENTRY_MARK, "").trim(), alsoAsked: [], keywords: [], answer: "", category: "" };
      field = "question";
      continue;
    }
    if (!cur) {
      headerLines.push(raw);
      continue;
    }
    const label = LABELS.find((l) => l.re.test(line));
    if (label) {
      const rest = line.replace(label.re, "").replace(/\*+$/, "").trim();
      field = label.key;
      if (label.key === "alsoAsked" || label.key === "keywords") cur[label.key] = splitList(rest);
      else cur[label.key] = rest;
      continue;
    }
    // A continuation line belongs to the field that is open: an answer's second sentence, a list's further item.
    if (field === "answer" || field === "question" || field === "category") cur[field] = `${cur[field]}${cur[field] ? "\n" : ""}${line.trim()}`.trim();
    else if (field === "alsoAsked" || field === "keywords") cur[field] = [...cur[field], ...splitList(line)];
  }
  push();
  return { header: headerLines.join("\n").trim(), entries };
}

/** How many entries a file carries, counted the way the walk counts them: one per `### Q:` line with a question and an answer. */
export const countEntries = (text: string): number => parseKnowledgeBase(text).entries.length;

/** A known category keeps the template's spelling; anything else keeps its own word, never invented and never dropped. */
export const normaliseCategory = (c: string): string => (FAQ_CATEGORIES as readonly string[]).find((k) => k.toLowerCase() === c.trim().toLowerCase()) ?? c.trim();

/**
 * "Needs your eyes": any answer mentioning a price, a guarantee, a result or a number. These are pinned at the top of the
 * Brief and can never be bulk-accepted; each takes its own Accept.
 */
export const NEEDS_EYES_WORDS = /\b(price|prices|pricing|cost|costs|fee|fees|guarantee|guaranteed|guarantees|refund|refunds|result|results)\b/i;
export const needsEyes = (e: { answer: string }): boolean => /\d/.test(e.answer) || /[$£€]/.test(e.answer) || NEEDS_EYES_WORDS.test(e.answer);

/**
 * The rank a push follows: Times Asked when the source carried it, else recency. Airtable's drafts have it empty, so recency is
 * the honest fallback. A batch import stamps every entry with the same second, so ties break on the id: arbitrary, but the same
 * everywhere, so the Brief and the push always agree on which entries drop.
 */
export type Rankable = { id: string; timesAsked: number | null; createdAt: string };
export function rankEntries<T extends Rankable>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (b.timesAsked ?? -1) - (a.timesAsked ?? -1) || (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One entry as it sits in the composed field: the question and the answer, the way the bot's prompt reads it. */
export const entryBlock = (e: { question: string; answer: string }): string => `Q: ${e.question.trim()}\nA: ${e.answer.trim()}`;
const SEPARATOR = "\n\n";

export type Composed<T> = { text: string; included: T[]; dropped: T[]; chars: number; budget: number };
/**
 * The approved answers composed into one field, in rank order, under the budget: whole entries only, so a cut never lands
 * mid-sentence in the bot's prompt; the entries that do not fit are dropped whole, lowest-ranked first, and listed.
 */
export function composeField<T extends { question: string; answer: string }>(ranked: T[], budget: number = FAQ_FIELD_BUDGET): Composed<T> {
  const included: T[] = [];
  const dropped: T[] = [];
  let text = "";
  for (const e of ranked) {
    const block = entryBlock(e);
    const next = text ? `${text}${SEPARATOR}${block}` : block;
    if (next.length <= budget && !dropped.length) {
      text = next;
      included.push(e);
    } else dropped.push(e); // Once one is dropped the rest are too: the order is the rank, and a lower entry never jumps a higher one.
  }
  return { text, included, dropped, chars: text.length, budget };
}

export type SnapshotEntry = { id: string; question: string; answer: string };
/** What changed since the last successful sync: added, edited (same id, different words), removed. Before any sync, everything is added. */
export function diffSinceSync(current: SnapshotEntry[], last: SnapshotEntry[] | null): { added: SnapshotEntry[]; edited: SnapshotEntry[]; removed: SnapshotEntry[] } {
  const was = new Map((last ?? []).map((e) => [e.id, e]));
  const now = new Map(current.map((e) => [e.id, e]));
  const added = current.filter((e) => !was.has(e.id));
  const edited = current.filter((e) => was.has(e.id) && (was.get(e.id)!.question !== e.question || was.get(e.id)!.answer !== e.answer));
  const removed = (last ?? []).filter((e) => !now.has(e.id));
  return { added, edited, removed };
}

/**
 * POST /flow/ai-agent-info answers the agent's description, prompts and functions. Its exact shape is the platform's, not the
 * repo's, so nothing is assumed about it: every string under the reply's data is harvested with the path it sat at, and the
 * tokens are found in those strings. A reply with no data is no agent.
 */
export type AgentInfo = { ns: string; name: string; prompts: { section: string; text: string }[] };
export function parseAgentInfo(body: unknown): AgentInfo | null {
  const b = body as { data?: unknown };
  const data = b && typeof b === "object" ? b.data : undefined;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const prompts: { section: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") prompts.push({ section: path, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(d, "");
  return { ns: String(d.ai_agent_ns ?? d.ns ?? ""), name: String(d.name ?? ""), prompts };
}

/** The agents in a workspace, from GET /flow/ai-agents: `{ data: [{ ai_agent_ns, name }] }`, parsed and nothing else. */
export function parseAgents(body: unknown): { ns: string; name: string }[] {
  const b = body as { data?: unknown };
  if (!b || typeof b !== "object" || !Array.isArray(b.data)) return [];
  return (b.data as Record<string, unknown>[]).map((a) => ({ ns: String(a?.ai_agent_ns ?? a?.ns ?? ""), name: String(a?.name ?? "") })).filter((a) => a.ns);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The explicit token forms, `{name}` and `{{name}}`: counted when a prompt carries one, though Community Loyalty's editor never writes them. */
export const fieldToken = (name: string): RegExp => new RegExp(`\\{\\{?\\s*${escapeRe(name)}\\s*\\}?\\}`);
/** A field's variable id standing on its own: never inside a longer id or a word, so f5259v17 does not match f5259v174. */
export const nsToken = (ns: string): RegExp => new RegExp(`(?<![A-Za-z0-9_])${escapeRe(ns)}(?![A-Za-z0-9_])`);
/**
 * Whether an agent reads a bot field. Community Loyalty stores a field placed in a prompt as a chip that references the field by
 * its **variable id** (`var_ns`, e.g. `f52594v17424617`), with the field's name only as the chip's visible label (read from the
 * editor on Danno's bot, 22 Sep). So the question asked is "does the prompt carry this field's id", with the id resolved from
 * the bot-fields list (`nsByName`). The explicit `{name}` forms still count. The bare name in prose never does: the platform
 * substitutes a chip, not a word, and a check that passed on a mention would let a push land in a prompt that never reads it.
 * Every reader goes through here: the Brief's "Your bot reads", the check before a push and the read-back after it, and Stage 1's.
 */
export function agentReadsFields(info: AgentInfo, fields: string[], nsByName: Record<string, string> = {}): { reads: string[]; notRead: string[] } {
  const all = info.prompts.map((p) => p.text).join("\n");
  const reads = fields.filter((f) => fieldToken(f).test(all) || (nsByName[f] ? nsToken(nsByName[f]).test(all) : false));
  return { reads, notRead: fields.filter((f) => !reads.includes(f)) };
}
/** The plain warning beside a field the agent does not read, from the ruling. */
export const notReadWarning = (field: string): string => `your bot does not use ${field} yet`;

/**
 * One row of Danno's CommunityLoyalty FAQ table in Airtable, mapped by the field names the §1 report listed. Bot Answer is the
 * answer; Answer stands in when Bot Answer is empty. Only a Published row is imported; a Draft is left in Airtable.
 */
export type AirtableFaqRecord = { id: string; fields: Record<string, unknown> };
const s = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join(", ") : v == null ? "" : String(v)).trim();
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export function fromAirtable(r: AirtableFaqRecord): (ParsedEntry & { timesAsked: number | null; published: boolean; sourceRef: string }) | null {
  const question = s(r.fields["Question"]);
  const answer = s(r.fields["Bot Answer"]) || s(r.fields["Answer"]);
  if (!question || !answer) return null;
  return {
    question,
    answer,
    alsoAsked: splitList(s(r.fields["Alt Phrasings"])),
    keywords: splitList(s(r.fields["Keywords"])),
    category: normaliseCategory(s(r.fields["Category"])),
    timesAsked: n(r.fields["Times Asked"]),
    published: /published/i.test(s(r.fields["Status"])),
    sourceRef: r.id,
  };
}

/**
 * A field the FAQ is never written to, whatever the coach types: a Stage 1 field (that push owns it), a field the bot or its
 * agent writes (a calendar, a booking), or any product-and-service field (it holds the coach's own offer description, which a
 * FAQ push would erase). The refusal names the field and why, in the coach's words. Null means the field is allowed.
 */
export function faqFieldRefusal(field: string, stage1: readonly string[], botWritten: readonly string[]): string | null {
  const f = field.trim();
  if (!f) return "No FAQ field set.";
  if (/^ai_product_/i.test(f)) return `${f} holds your offer description, and sending the FAQ there would erase it. Pick a field of its own.`;
  if (stage1.includes(f)) return `${f} is written by the business-facts sync, so the FAQ can't use it. Pick a field of its own.`;
  if (botWritten.includes(f)) return `${f} is written by your bot itself, so the FAQ can't use it. Pick a field of its own.`;
  return null;
}

/**
 * The field already holds text HelixOS did not write. What HelixOS wrote is exactly the last successful sync's value, so
 * anything else in the field came from the coach or the platform and would be erased by a push.
 */
export const holdsForeignText = (held: string | null | undefined, lastSentValue: string | null | undefined): boolean => Boolean(held && held.trim() && !isFaqEmptyValue(held) && held.trim() !== (lastSentValue ?? "").trim());

/** The Brief's line when the field is not on the bot at all: the API sets a field by name, it does not create one. */
export const fieldMissingLine = (field: string): string => `Your bot needs the FAQ field added once: create ${field} on it, and put its token in the prompt of the agent that answers questions. Nothing is sent until then.`;
/** The Brief's line when the field is not the roomiest type the platform offers: a warning, never a refusal. */

/**
 * Which agent the Brief reads and pushes to. The coach chooses it on the Coach page; blank never silently means "the first
 * one", because the agent that answers questions is not always the first. Blank with exactly one agent is no choice at all, so
 * it is taken; blank with more than one asks.
 */
export type AgentPick = { kind: "chosen"; ns: string } | { kind: "only"; ns: string } | { kind: "ask"; agents: { ns: string; name: string }[] } | { kind: "none" };
export function pickAgent(chosen: string | null | undefined, agents: { ns: string; name: string }[]): AgentPick {
  const ns = (chosen ?? "").trim();
  if (ns) return { kind: "chosen", ns };
  if (agents.length === 1) return { kind: "only", ns: agents[0].ns };
  if (agents.length > 1) return { kind: "ask", agents };
  return { kind: "none" };
}
/** The Brief's line when more than one agent exists and none is chosen. */
export const chooseAgentLine = (agents: { name: string }[]): string => `Your bot has ${agents.length} agents (${agents.map((a) => a.name).join(", ")}). Choose the one that answers questions on the Coach page; nothing is sent until then.`;
