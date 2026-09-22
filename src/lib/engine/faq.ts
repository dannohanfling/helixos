/**
 * The coach's brain, the pure part: the Knowledge Base Builder format parsed deterministically (no model), the rule that
 * pins an answer to "Needs your eyes", the rank a push follows, the one longtext field the approved answers compose into under
 * a single budget (whole entries dropped past it and listed), the diff since the last sync, and which bot-field tokens the
 * target agent's prompt actually reads. Nothing here reads the database or calls the network; the actions and the client
 * call in with what the record and the platform hold.
 */
import { FAQ_CATEGORIES } from "@/db/schema";

/** The single configurable limit on the composed field, in characters. 20,000 until Danno confirms the platform's real maximum. Named on the Brief. */
export const FAQ_FIELD_BUDGET = 20000;
/** The one longtext bot field the approved answers go to: the Product & Service Information token the Booking Agent reads (rev-19 finding). Overridable per member. */
export const FAQ_BOT_FIELD_DEFAULT = "ai_product_&_service_information_cbf";

export type ParsedEntry = { question: string; alsoAsked: string[]; keywords: string[]; answer: string; category: string };
export type ParsedKnowledgeBase = { header: string; entries: ParsedEntry[] };

const ENTRY_MARK = /^###\s*Q:\s*/i;
const LABELS: { key: keyof ParsedEntry; re: RegExp }[] = [
  { key: "alsoAsked", re: /^\**\s*also asked\s*:?\s*\**\s*:?\s*/i },
  { key: "keywords", re: /^\**\s*keywords\s*:?\s*\**\s*:?\s*/i },
  { key: "answer", re: /^\**\s*answer\s*:?\s*\**\s*:?\s*/i },
  { key: "category", re: /^\**\s*category\s*:?\s*\**\s*:?\s*/i },
];
const splitList = (s: string): string[] => s.split(/[,;\n]|\s\/\s/).map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);

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

/** A bot field is read by an agent when its token — `{name}` or `{{name}}` — appears in any of the agent's prompt text. */
export const fieldToken = (name: string): RegExp => new RegExp(`\\{\\{?\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}?\\}`);
export function agentReadsFields(info: AgentInfo, fields: string[]): { reads: string[]; notRead: string[] } {
  const all = info.prompts.map((p) => p.text).join("\n");
  const reads = fields.filter((f) => fieldToken(f).test(all));
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
