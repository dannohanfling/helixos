/**
 * Socrates Domain, pure: the seven CLARITY beats, the script types, the filters the library and the wizard share,
 * and the assembly of a finished script. All words in the library are Danno's seed content; nothing here writes any.
 */
import foundationsJson from "@/data/seed/socrates/foundations.json";
import questionsJson from "@/data/seed/socrates/questions.json";
import reframesJson from "@/data/seed/socrates/reframes.json";

export type Beat = { key: string; letter: string; name: string; stage: string };
/** In order. `stage` is the exact tag the question library carries. */
export const CLARITY_BEATS: Beat[] = [
  { key: "C", letter: "C", name: "Context", stage: "C — Context" },
  { key: "L", letter: "L", name: "Landscape", stage: "L — Landscape" },
  { key: "A", letter: "A", name: "Areas of Friction", stage: "A — Areas of Friction" },
  { key: "R", letter: "R", name: "Result Desired", stage: "R — Result Desired" },
  { key: "I", letter: "I", name: "Implications", stage: "I — Implications" },
  { key: "T", letter: "T", name: "Tailor the Solution", stage: "T — Tailor the Solution" },
  { key: "Y", letter: "Y", name: "Your Next Step", stage: "Y — Your Next Step" },
];
export const beatByKey = (key: string): Beat | undefined => CLARITY_BEATS.find((b) => b.key === key);
export const beatByStage = (stage: string): Beat | undefined => CLARITY_BEATS.find((b) => b.stage === stage);

export const SCRIPT_TYPES = ["High-Ticket Sales Call", "Cold Call", "DM", "Follow-Up", "Objection", "Presentation Close", "Community Reachout", "Referral"] as const;
export type ScriptType = (typeof SCRIPT_TYPES)[number];
export const NEPQ_CATEGORIES = ["Connecting", "Situation", "Problem Awareness", "Solution Awareness", "Consequence", "Qualifying", "Decision Making", "Committing", "Clarifying / Probing", "Transition", "Two Truths", "Past Situation", "Pre-Situation", "Referral"] as const;
export const QUESTION_SOURCES = ["NEPQ", "Matt Ryder", "Danno Custom"] as const;
/** The three objection groups, in the order the brief lists them: the groups a spoken reframe answers. */
export const OBJECTION_GROUPS = ["Price / too expensive", "No time / too busy", "Needs a partner's sign-off"] as const;
/** Where the principles live: coaching about how to hold yourself on a call, never a line said to a prospect. */
export const POSTURE_GROUP = "Posture";

export type Lesson = { order: number; section: string; topic: string; subtitle: string; body: string; whyItMatters: string; soundsLike: string };
export type LibraryQuestion = { id: string; question: string; nepqCategory: string; source: string; clarityStage: string; scriptTypes: string[] };
/**
 * Two kinds share the file: a spoken reframe is a line said to a prospect (transition in, phrase, metaphor) and gets the copy
 * button; a principle is coaching about posture, has no transition in and is never offered as something to paste to a prospect.
 * The text is content: it changes in the data file, through Danno, never here.
 */
export type ReframeType = "spoken" | "principle";
export type Reframe = { id: string; name: string; type: ReframeType; objectionGroup: string; credit: string | null; transitionIn: string | null; memorablePhrase: string; metaphor: string; simpleExplanation: string; whenToUse: string };

export const LESSONS: Lesson[] = [...(foundationsJson as Lesson[])].sort((a, b) => a.order - b.order);
export const LIBRARY_QUESTIONS: LibraryQuestion[] = questionsJson as LibraryQuestion[];
export const REFRAMES: Reframe[] = reframesJson as Reframe[];
export const SPOKEN_REFRAMES: Reframe[] = REFRAMES.filter((r) => r.type === "spoken");
export const PRINCIPLES: Reframe[] = REFRAMES.filter((r) => r.type === "principle");

/** What a spoken reframe is when copied or read into a script: the transition, the phrase, the metaphor; a credit, where there is one, travels with it. */
export function reframeCopyText(r: Reframe): string {
  const said = [r.transitionIn, r.memorablePhrase, r.metaphor].filter((x): x is string => Boolean(x && x.trim())).join(" ");
  return r.credit ? `${said}\nCredit: ${r.credit}` : said;
}
/** A principle copied as a note to self, never as something to say: its phrase and its two paragraphs, credited where there is one. */
export function principleNoteText(r: Reframe): string {
  return [r.memorablePhrase, r.metaphor, r.simpleExplanation, r.credit ? `Credit: ${r.credit}` : null].filter(Boolean).join("\n");
}
/** Several reframes copied at once carry their objection group and name as a heading, a blank line between entries; one alone stays clean. */
export function reframesCopyText(rs: Reframe[]): string {
  if (rs.length === 1) return reframeCopyText(rs[0]);
  return rs.map((r) => `${r.objectionGroup} — ${r.name}\n${reframeCopyText(r)}`).join("\n\n");
}

/** A paragraph addressed to the app build, not to a client, must never reach the page even if one lands in the seed again. */
const BUILD_NOTE = /^\*\*Note for the app build:\*\*/;
export function lessonParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !BUILD_NOTE.test(p));
}
export const hasBuildNote = (body: string) => body.split(/\n\s*\n/).some((p) => BUILD_NOTE.test(p.trim()));
/** A lesson that talks about the reframe library gets a link to it under the text. */
export const mentionsReframes = (body: string) => /reframe library/i.test(body);

/** The beat where a reframe is deployed in an Objection script: clarified through C, L and A, discussed at I, reframed at T, asked again at Y. */
export const REFRAME_BEAT = "T";

/** Any question the wizard or the library can show: a seed row or a client's own. */
export type QuestionLike = { id: string; question: string; clarityStage: string; nepqCategory: string | null; source: string; scriptTypes: string[]; own?: boolean };

/** The library the client sees at one beat of one script: tagged for that beat and that script type. */
export function questionsFor(all: QuestionLike[], stage: string | null, scriptType: string | null): QuestionLike[] {
  return all.filter((q) => (!stage || q.clarityStage === stage) && (!scriptType || q.scriptTypes.includes(scriptType)));
}

/** The spoken reframes by the objection in front of you; principles are not in these groups (see PRINCIPLES). */
export function reframesByGroup(reframes: Reframe[] = SPOKEN_REFRAMES): { group: string; reframes: Reframe[] }[] {
  const spoken = reframes.filter((r) => r.type === "spoken");
  const known = OBJECTION_GROUPS.map((group) => ({ group, reframes: spoken.filter((r) => r.objectionGroup === group) }));
  const other = spoken.filter((r) => !(OBJECTION_GROUPS as readonly string[]).includes(r.objectionGroup));
  return other.length ? [...known, { group: "Other", reframes: other }] : known;
}

/**
 * One beat as saved. `questionIds` is ordered: the first is the question, the rest are its follow-ups (at most MAX_FOLLOW_UPS).
 * `listenFor` is the client's own note on the shape of the answer, never the prospect's words. `branchIds` are the spoken
 * reframes offered if the prospect pushes back at this beat; undefined means never decided, so the beat's defaults apply.
 */
export type BeatDraft = { questionIds: string[]; reframeIds: string[]; override: string | null; listenFor?: string | null; branchIds?: string[] };
export type ScriptBeats = Record<string, BeatDraft>;
export const emptyBeat = (): BeatDraft => ({ questionIds: [], reframeIds: [], override: null });
export const MAX_FOLLOW_UPS = 2;
export const beatOf = (beats: ScriptBeats, key: string): BeatDraft => beats[key] ?? emptyBeat();

/** A beat is done when it has a library pick or an override; both may be used. */
export function beatDone(b: BeatDraft): boolean {
  return b.questionIds.length > 0 || b.reframeIds.length > 0 || Boolean(b.override?.trim());
}
export function progress(beats: ScriptBeats): { done: number; total: number; complete: boolean } {
  const done = CLARITY_BEATS.filter((b) => beatDone(beatOf(beats, b.key))).length;
  return { done, total: CLARITY_BEATS.length, complete: done === CLARITY_BEATS.length };
}

/* ───────────────────────── Branches: if they push back here ───────────────────────── */

/** The beats where a branch is on by default; at the other five it is available but off. */
export const BRANCH_DEFAULT_BEATS = ["T", "Y"] as const;
/** The condition line above a branch, one per objection group: a move the prospect makes, not a sentence they say. Danno's words, all three. */
export const BRANCH_CONDITIONS: Record<string, string> = {
  "Price / too expensive": "If they go to the number",
  "No time / too busy": "If it comes back to time",
  "Needs a partner's sign-off": "If they need to talk to a partner",
};
/** The prefilled branches at a beat that carries them by default: the first spoken reframe of each objection group. Spoken only, ever. */
export function defaultBranchIds(beatKey: string): string[] {
  if (!(BRANCH_DEFAULT_BEATS as readonly string[]).includes(beatKey)) return [];
  return reframesByGroup().flatMap((g) => (g.reframes[0] ? [g.reframes[0].id] : []));
}
/** The branches a saved beat carries: what the client decided, or the beat's defaults if they never did. Principles never pass. */
export function branchesFor(b: BeatDraft, beatKey: string): Reframe[] {
  const ids = b.branchIds ?? defaultBranchIds(beatKey);
  return SPOKEN_REFRAMES.filter((r) => ids.includes(r.id));
}

/* ───────────────────────── Placeholders and fills ───────────────────────── */

const PLACEHOLDER = /\[([^\[\]]+)\]/g;
export type Fills = Record<string, string>;
/** The key a placeholder is asked by: its text inside the brackets, trimmed, so `[X]` in two questions is one blank. `[ ]` is no blank. */
export const placeholderKey = (raw: string) => raw.trim();
export function placeholdersIn(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => placeholderKey(m[1])).filter(Boolean);
}
/** Whatever is typed carries no square brackets into an output: a stray or nested bracket, or one typed into a fill, becomes a parenthesis. */
export const noBrackets = (text: string) => text.replace(/[[\]]/g, (m) => (m === "[" ? "(" : ")"));
/**
 * What the fill step asks for each blank: the label, a help line where the brief gave one, and where a value comes from.
 * `[X]` is asked once at the top and substituted everywhere; `[3 pillars]` is the client's offer, prefilled and editable.
 */
export const PLACEHOLDER_PROMPTS: Record<string, { label?: string; help?: string; source?: "offer" }> = {
  X: { label: "What is this conversation about?" },
  "their pain phrase": { help: "In their words, not yours" },
  "3 pillars": { source: "offer" },
};
/** Every blank the script contains, once each, in the order it is met: the questions, the listen-for note and the client's own words at every beat. */
export function placeholdersOf(assembled: AssembledBeat[]): string[] {
  const out: string[] = [];
  for (const a of assembled) for (const t of [...a.questions.map((q) => q.question), a.listenFor ?? "", a.override ?? ""]) for (const k of placeholdersIn(t)) if (!out.includes(k)) out.push(k);
  return out;
}
export const UNFILLED_OPEN = "«unfilled: ";
export const UNFILLED_CLOSE = "»";
/** A blank left empty is shown as unfilled, never passed through as finished text. The output carries no square brackets. */
export const unfilledMark = (key: string) => `${UNFILLED_OPEN}${key}${UNFILLED_CLOSE}`;
export function fillText(text: string, fills: Fills): string {
  const filled = text.replace(PLACEHOLDER, (m, raw: string) => {
    const key = placeholderKey(raw);
    if (!key) return m;
    const value = fills[key]?.trim();
    return value ? noBrackets(value) : unfilledMark(key);
  });
  return noBrackets(filled);
}
export function unfilledIn(assembled: AssembledBeat[], fills: Fills): string[] {
  return placeholdersOf(assembled).filter((k) => !fills[k]?.trim());
}

/* ───────────────────────── Assembly ───────────────────────── */

export type AssembledBeat = { beat: Beat; questions: QuestionLike[]; reframes: Reframe[]; override: string | null; listenFor: string | null; branches: Reframe[] };
/** The whole script in CLARITY order: the question and its follow-ups in pick order, then reframes, then the client's own words. */
export function assemble(beats: ScriptBeats, questions: QuestionLike[], reframes: Reframe[] = SPOKEN_REFRAMES): AssembledBeat[] {
  return CLARITY_BEATS.map((beat) => {
    const b = beatOf(beats, beat.key);
    return {
      beat,
      questions: b.questionIds.map((id) => questions.find((q) => q.id === id)).filter((q): q is QuestionLike => Boolean(q)),
      reframes: reframes.filter((r) => b.reframeIds.includes(r.id)),
      override: b.override?.trim() || null,
      listenFor: b.listenFor?.trim() || null,
      branches: branchesFor(b, beat.key),
    };
  });
}
/** Plain text of the finished script as the builder reads it back, letters and all: the teaching view, not the call. */
export function scriptText(name: string, scriptType: string, assembled: AssembledBeat[]): string {
  const out: string[] = [`${name} (${scriptType})`, ""];
  for (const a of assembled) {
    out.push(`${a.beat.letter} — ${a.beat.name}`);
    for (const q of a.questions) out.push(q.question);
    for (const r of a.reframes) out.push(reframeCopyText(r));
    if (a.override) out.push(a.override);
    out.push("");
  }
  return out.join("\n").trim();
}

/* ───────────────────────── The call sheet: two sides, three outputs ───────────────────────── */

/**
 * The sheet a client runs a call from. YOU is said as written. "Listen for" is the shape of the answer in the client's own
 * note, never the prospect's lines: the app writes nothing in a prospect's mouth. A branch is a spoken reframe under the
 * condition of its objection group. Blanks are filled or shown unfilled.
 */
export type SheetBranch = { condition: string; group: string; lines: { said: string; name: string }[] };
/** `reframes` are an Objection script's own reframes at Tailor: spoken as written, never filled, never in the copy block. */
export type SheetBeat = { n: number; name: string; you: string[]; followUps: string[]; reframes: { said: string; name: string }[]; listenFor: string | null; branches: SheetBranch[] };
export type CallSheet = { title: string; subtitle: string; beats: SheetBeat[] };
export const SHEET_SUBTITLE = "Built from CLARITY";

export function callSheet(name: string, scriptType: string, assembled: AssembledBeat[], fills: Fills): CallSheet {
  const beats = assembled.map((a, i) => {
    const said = [...a.questions.map((q) => q.question), ...(a.override ? [a.override] : [])].map((t) => fillText(t, fills));
    // A reframe the script itself deploys here is not offered again as a branch at the same beat.
    const deployed = new Set(a.reframes.map((r) => r.id));
    const groups = new Map<string, Reframe[]>();
    for (const r of a.branches) if (!deployed.has(r.id)) groups.set(r.objectionGroup, [...(groups.get(r.objectionGroup) ?? []), r]);
    const branches: SheetBranch[] = Array.from(groups, ([group, rs]) => ({
      group,
      condition: BRANCH_CONDITIONS[group] ?? `If it's ${group}`,
      // reframeCopyText already carries the credit where there is one; nothing is appended twice.
      lines: rs.map((r) => ({ said: reframeCopyText(r), name: r.name })),
    }));
    return { n: i + 1, name: a.beat.name, you: said.slice(0, 1), followUps: said.slice(1), reframes: a.reframes.map((r) => ({ said: reframeCopyText(r), name: r.name })), listenFor: a.listenFor ? fillText(a.listenFor, fills) : null, branches };
  });
  return { title: `${scriptType.toUpperCase()} — ${name}`, subtitle: SHEET_SUBTITLE, beats };
}

const RULE = "─".repeat(46);
const WRITING_SPACE = ["  " + "_".repeat(47), "  " + "_".repeat(47)];
const indent = (text: string, pad: string) => text.split("\n").map((l) => pad + l).join("\n");
/** The call sheet as plain text: the live, printed shape. */
export function callSheetText(sheet: CallSheet): string {
  const out: string[] = [sheet.title, sheet.subtitle, "", RULE];
  for (const b of sheet.beats) {
    out.push("", `${b.n} · ${b.name.toUpperCase()}`, "", "  YOU");
    for (const line of b.you) out.push(indent(line, "  "));
    for (const line of b.followUps) out.push("", "  Follow-up", indent(line, "  "));
    for (const r of b.reframes) {
      const [said, ...rest] = r.said.split("\n");
      out.push("", "  Reframe", indent(`"${said}"`, "  "), ...rest.map((x) => indent(x, "   ")), `   — ${r.name}`);
    }
    if (b.listenFor) out.push("", indent(b.listenFor, "  "));
    for (const br of b.branches) {
      out.push("", `  ↳ ${br.condition}`);
      for (const l of br.lines) {
        const [said, ...rest] = l.said.split("\n");
        out.push(indent(`"${said}"`, "    "), ...rest.map((r) => indent(r, "     ")), `     — ${l.name}`);
      }
    }
    out.push("", ...WRITING_SPACE, "", RULE);
  }
  return out.join("\n");
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * The same sheet as HTML for the clipboard's second flavour, so Docs, Word and Notion keep the italics and indents. Every line is
 * its own block element: a converter turns a block boundary into a blank line, and never into a backslash the way it does a <br>.
 */
export function callSheetHtml(sheet: CallSheet): string {
  const p = (text: string, style = "") => `<p style="margin:0 0 4px 0;${style}">${esc(text)}</p>`;
  const em = (text: string, style = "") => `<p style="margin:0 0 4px 0;${style}"><em>${esc(text)}</em></p>`;
  const out: string[] = [p(sheet.title, "font-weight:600;font-size:1.1em"), em(sheet.subtitle, "color:#666;font-size:0.9em")];
  for (const b of sheet.beats) {
    out.push(`<hr style="border:0;border-top:1px solid #999;margin:14px 0" />`, p(`${b.n} · ${b.name.toUpperCase()}`, "color:#666;font-size:0.8em;letter-spacing:0.05em"), p("YOU", "color:#666;font-size:0.8em"));
    for (const line of b.you) for (const l of line.split("\n")) out.push(p(l, "font-size:1.15em"));
    for (const line of b.followUps) {
      out.push(p("Follow-up", "color:#666;font-size:0.8em"));
      for (const l of line.split("\n")) out.push(p(l));
    }
    for (const r of b.reframes) {
      const [said, ...rest] = r.said.split("\n");
      out.push(p("Reframe", "color:#666;font-size:0.8em"), p(`"${said}"`), ...rest.map((x) => p(x, "color:#666;font-size:0.85em")), p(`— ${r.name}`, "color:#666;font-size:0.85em"));
    }
    if (b.listenFor) for (const l of b.listenFor.split("\n")) out.push(em(l, "color:#666;font-size:0.9em"));
    for (const br of b.branches) {
      out.push(em(`↳ ${br.condition}`, "margin-left:16px"));
      for (const l of br.lines) {
        const [said, ...rest] = l.said.split("\n");
        out.push(p(`"${said}"`, "margin-left:32px"), ...rest.map((r) => p(r, "margin-left:32px;color:#666;font-size:0.85em")), p(`— ${l.name}`, "margin-left:32px;color:#666;font-size:0.85em"));
      }
    }
    for (const w of WRITING_SPACE) out.push(p(w.trim(), "color:#999"));
  }
  return out.join("");
}

/** The copy block for a DM or an email: the questions only, one per line, no branches, no labels, no blank lines. */
export function copyBlockText(sheet: CallSheet): string {
  return sheet.beats.flatMap((b) => [...b.you, ...b.followUps]).flatMap((l) => l.split("\n")).map((l) => l.trim()).filter(Boolean).join("\n");
}
