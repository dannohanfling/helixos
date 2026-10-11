/**
 * Avatars by interview (rev 636, answered rev 639), the pure parts: the questions, which comes next, and the checks the server
 * applies to the AI's draft before the member sees it. The member's own words are the only source: the words they use must
 * appear word for word in their answers, a number must appear in their answers, and a field with no answer behind it stays
 * empty ("not covered"). Anything dropped is listed. Nothing here reads the database or calls the AI.
 */
import { AVATAR_FIELDS, type AvatarField, type InterviewDraft, type InterviewTurn } from "@/db/schema";
import { AVATAR_FIELD_INFO } from "@/lib/engine/avatars";

/** One plain question per field, asked in this order. */
export const INTERVIEW_QUESTIONS: Record<AvatarField, string> = {
  who: "Think of one real person you'd love to work with. Who are they: what do they do, and where are they at right now?",
  pains: "What's going wrong for them? Tell me the problems they'd complain about.",
  wants: "If it all worked out, what would they have? What would they happily pay for?",
  tried: "What have they already tried to fix it, and how did that go?",
  objections: "When they're about to say yes, what do they say to talk themselves out of it?",
  hangouts: "Where do they spend their time online and off: groups, podcasts, platforms, events?",
  phrases: "How do they say it, in their own words? Give me a few phrases exactly as they'd type them.",
  trigger: "What happens in the week they finally decide to get help? Why now?",
  framework: "How does your way of working fix their problem? Which part fixes which pain?",
  notFor: "Who is this not for? Who would you turn away?",
};

/** The interview's size (rev 639): about 8 to 12 questions; never more than 20. */
export const MAX_TURNS = 20;
/** At most this many follow-ups in one interview, one per field. */
export const MAX_FOLLOW_UPS = 2;
const blank = (s: string | null | undefined) => !(s ?? "").trim();

/** The fields an interview asks about: all ten for a new avatar, only the empty ones for an existing one. */
export function fieldsToAsk(avatar: Partial<Record<AvatarField, string | null>> | null): AvatarField[] {
  return AVATAR_FIELDS.filter((f) => !avatar || blank(avatar[f]));
}

/** The question waiting for an answer, or null. */
export const openTurn = (turns: InterviewTurn[]): InterviewTurn | null => (turns.length && turns.at(-1)!.answer === null ? turns.at(-1)! : null);

/**
 * What to ask after an answer: the follow-up the AI offered for that same field (when it isn't a follow-up already, the field
 * hasn't had one and the interview has follow-ups left), else the next field not yet asked. Null when every field is asked
 * or the hard stop is reached.
 */
export function nextTurn(turns: InterviewTurn[], fields: AvatarField[], followUp?: string | null): InterviewTurn | null {
  if (turns.length >= MAX_TURNS || openTurn(turns)) return null;
  const last = turns.at(-1);
  const used = turns.filter((t) => t.followUp).length;
  const q = (followUp ?? "").trim();
  if (last && q && !last.followUp && !blank(last.answer) && used < MAX_FOLLOW_UPS && !turns.some((t) => t.followUp && t.field === last.field)) return { field: last.field, question: q.slice(0, 400), answer: null, followUp: true };
  const asked = new Set(turns.map((t) => t.field));
  const field = fields.find((f) => !asked.has(f));
  return field ? { field, question: INTERVIEW_QUESTIONS[field], answer: null, followUp: false } : null;
}

/** How far along: "Question 4 of about 10". */
export function progressWords(turns: InterviewTurn[], fields: AvatarField[]): string {
  return `Question ${turns.length} of about ${Math.max(turns.length, fields.length)}`;
}

/** The questions and answers as the AI reads them, each numbered so the draft can say which answer a field came from. */
export function transcript(turns: InterviewTurn[]): string {
  return turns
    .map((t, i) => (blank(t.answer) ? null : `Q${i + 1} (${t.field}): ${t.question}\nA${i + 1} (${t.field}): ${t.answer!.trim()}`))
    .filter(Boolean)
    .join("\n\n");
}

/** The follow-up step: one short question if the answer is thin or vague, else NEXT. */
export const FOLLOW_UP_TASK = `AVATAR_INTERVIEW_FOLLOWUP. You are interviewing a coach about one ideal client, one question at a time. Read their latest answer. If it is vague or thin, reply with ONE short, plain follow-up question that asks for a concrete example in their own words (for example "What did that cost them?"). If the answer is clear enough, reply with exactly NEXT. Never answer for them, never suggest an answer, never use their words to lead them.`;

/** The draft step: the ten fields from their answers only, as JSON. */
export const DRAFT_TASK = `AVATAR_INTERVIEW_DRAFT. Turn this interview into a buyer avatar. Use ONLY what the coach said. For each field return the text and the numbers of the answers it came from. Leave a field out when no answer covers it. "phrases" must be their exact words, copied word for word from the answers, one per line. Never add a number, a quote, a pain or a claim they did not give. Reply with JSON only: {"name": "a short name for this avatar", "fields": {"who": {"text": "...", "from": [1]}, ...}} using the keys ${AVATAR_FIELDS.join(", ")}.`;

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const NUMBER = /\d[\d,.]*%?|\$\s?\d[\d,.]*/g;
/** The numbers a text carries, as digits only ("$4,200" and "4200" are the same number). */
const numbersIn = (s: string): string[] => (s.match(NUMBER) ?? []).map((n) => n.replace(/[^\d.]/g, "").replace(/\.$/, "")).filter(Boolean);

/**
 * The server's checks on the AI's draft. A field keeps only what its answers support: it must name answers that exist and
 * were given; "phrases" keeps only lines found word for word in the answers; a line with a number the answers never had is
 * dropped. A field left with nothing is not covered. Everything dropped is listed, in the member's words.
 */
export function checkDraft(raw: unknown, turns: InterviewTurn[], fields: AvatarField[]): InterviewDraft & { notCovered: AvatarField[] } {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; fields?: Record<string, { text?: unknown; from?: unknown }> };
  const answered = new Map(turns.map((t, i) => [i + 1, t] as const).filter(([, t]) => !blank(t.answer)));
  const all = norm([...answered.values()].map((t) => t.answer!).join("\n"));
  const allNumbers = new Set(numbersIn([...answered.values()].map((t) => t.answer!).join(" ")));
  const out: InterviewDraft["fields"] = {};
  const dropped: string[] = [];
  for (const f of fields) {
    const got = obj.fields?.[f];
    const text = typeof got?.text === "string" ? got.text.replace(/\r\n?/g, "\n").trim() : "";
    if (!text) continue;
    const from = (Array.isArray(got?.from) ? got!.from : []).map(Number).filter((n) => answered.has(n));
    if (!from.length) {
      dropped.push(`${AVATAR_FIELD_INFO[f].label}: no answer behind it`);
      continue;
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const kept: string[] = [];
    for (const line of lines) {
      const bare = line.replace(/^[•\-*]\s*/, "").replace(/^["“]|["”]$/g, "").trim();
      if (f === "phrases" && !all.includes(norm(bare))) {
        dropped.push(`"${bare}" (you didn't say it)`);
        continue;
      }
      const bad = numbersIn(line).filter((n) => !allNumbers.has(n));
      if (bad.length) {
        dropped.push(`"${line}" (a number you didn't give)`);
        continue;
      }
      kept.push(line);
    }
    if (kept.length) out[f] = { text: kept.join("\n"), from };
  }
  const name = typeof obj.name === "string" ? obj.name.replace(/\s+/g, " ").trim().slice(0, 80) || null : null;
  return { name, fields: out, dropped, notCovered: fields.filter((f) => !out[f]) };
}

/** The draft's first line for the member and for Claude: "7 of 10 filled; left out: 2 things you didn't say". */
export function draftSummary(d: InterviewDraft, fields: AvatarField[]): string {
  const filled = fields.filter((f) => d.fields[f]).length;
  return `${filled} of ${fields.length} filled from your answers${d.dropped.length ? `; left out: ${d.dropped.length} thing${d.dropped.length === 1 ? "" : "s"} you didn't say` : ""}`;
}

export type FieldChoice = { keep: "keep" | "edit" | "skip"; text?: string };
/**
 * What saves: only the fields kept (as drafted) or edited (as the member typed them). For an existing avatar, never a field
 * that has filled in since the interview began: those are left exactly as they are.
 */
export function fieldsToSave(d: InterviewDraft, choices: Partial<Record<AvatarField, FieldChoice>>, existing: Partial<Record<AvatarField, string | null>> | null): Partial<Record<AvatarField, string>> {
  const out: Partial<Record<AvatarField, string>> = {};
  for (const f of AVATAR_FIELDS) {
    const c = choices[f];
    if (!c || c.keep === "skip") continue;
    if (existing && !blank(existing[f])) continue;
    const text = c.keep === "edit" ? (c.text ?? "").trim() : (d.fields[f]?.text ?? "");
    if (text) out[f] = text;
  }
  return out;
}
