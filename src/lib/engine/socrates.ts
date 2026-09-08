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
/** The four objection groups, in the order the brief lists them. */
export const OBJECTION_GROUPS = ["Price / too expensive", "No time / too busy", "Needs a partner's sign-off", "General resistance (posture)"] as const;

export type Lesson = { order: number; section: string; topic: string; subtitle: string; body: string; whyItMatters: string; soundsLike: string };
export type LibraryQuestion = { id: string; question: string; nepqCategory: string; source: string; clarityStage: string; scriptTypes: string[] };
export type Reframe = { id: string; name: string; objectionGroup: string; memorablePhrase: string; metaphor: string; simpleExplanation: string; transitionIn: string; whenToUse: string; credit?: string };

export const LESSONS: Lesson[] = [...(foundationsJson as Lesson[])].sort((a, b) => a.order - b.order);
export const LIBRARY_QUESTIONS: LibraryQuestion[] = questionsJson as LibraryQuestion[];
export const REFRAMES: Reframe[] = reframesJson as Reframe[];

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

export function reframesByGroup(reframes: Reframe[] = REFRAMES): { group: string; reframes: Reframe[] }[] {
  const known = OBJECTION_GROUPS.map((group) => ({ group, reframes: reframes.filter((r) => r.objectionGroup === group) }));
  const other = reframes.filter((r) => !(OBJECTION_GROUPS as readonly string[]).includes(r.objectionGroup));
  return other.length ? [...known, { group: "Other", reframes: other }] : known;
}

export type BeatDraft = { questionIds: string[]; reframeIds: string[]; override: string | null };
export type ScriptBeats = Record<string, BeatDraft>;
export const emptyBeat = (): BeatDraft => ({ questionIds: [], reframeIds: [], override: null });
export const beatOf = (beats: ScriptBeats, key: string): BeatDraft => beats[key] ?? emptyBeat();

/** A beat is done when it has a library pick or an override; both may be used. */
export function beatDone(b: BeatDraft): boolean {
  return b.questionIds.length > 0 || b.reframeIds.length > 0 || Boolean(b.override?.trim());
}
export function progress(beats: ScriptBeats): { done: number; total: number; complete: boolean } {
  const done = CLARITY_BEATS.filter((b) => beatDone(beatOf(beats, b.key))).length;
  return { done, total: CLARITY_BEATS.length, complete: done === CLARITY_BEATS.length };
}

export type AssembledBeat = { beat: Beat; questions: QuestionLike[]; reframes: Reframe[]; override: string | null };
/** The whole script in CLARITY order: library picks in library order, then reframes, then the client's own words. */
export function assemble(beats: ScriptBeats, questions: QuestionLike[], reframes: Reframe[] = REFRAMES): AssembledBeat[] {
  return CLARITY_BEATS.map((beat) => {
    const b = beatOf(beats, beat.key);
    return {
      beat,
      questions: questions.filter((q) => b.questionIds.includes(q.id)),
      reframes: reframes.filter((r) => b.reframeIds.includes(r.id)),
      override: b.override?.trim() || null,
    };
  });
}
/** Plain text of the finished script, the thing the client copies out. */
export function scriptText(name: string, scriptType: string, assembled: AssembledBeat[]): string {
  const out: string[] = [`${name} (${scriptType})`, ""];
  for (const a of assembled) {
    out.push(`${a.beat.letter} — ${a.beat.name}`);
    for (const q of a.questions) out.push(q.question);
    for (const r of a.reframes) out.push(`${r.transitionIn} ${r.memorablePhrase} ${r.metaphor}`);
    if (a.override) out.push(a.override);
    out.push("");
  }
  return out.join("\n").trim();
}
