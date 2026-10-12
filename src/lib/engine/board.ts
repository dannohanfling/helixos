/**
 * My Board (rev 664), the pure parts: the five seats, the modes, Danno's principles seeded from the pack, the prompt
 * built from Cowork's spec (docs/board/, copied in src/content/board-spec.ts), and the checks the server applies to every answer
 * before the member sees it. The spec is ported, never re-invented: the voices, modes and hard rules are the files' own words.
 * Nothing here reads the database or calls the AI.
 */
import { addDays, weekday } from "@/lib/dates";
import { BOARD_PROFILE_MD, BOARD_SKILL_MD, DANNO_SOURCE_PACK_MD } from "@/content/board-spec";
import { MODE_INFO, takesWords, type Mode } from "@/lib/engine/board-view";
export { MODES, MODE_INFO, SEAT_SPOTS, SKILL_INSTALL_STEPS, SPEAK_MS, takesWords, type Mode } from "@/lib/engine/board-view";

/* ───────────────────────── The seats ───────────────────────── */

export const SEAT_KEYS = ["danno", "alex", "jordan", "morgan", "riley"] as const;
export type SeatKey = (typeof SEAT_KEYS)[number];
export type Seat = { key: string; name: string; emoji: string; icon: string | null; job: string; short: string; role: string };
/** The Board, exactly five, fixed for clients (rev 664 §1), with Cowork's seat icons. */
export const SEATS: Seat[] = [
  { key: "danno", name: "Danno", short: "Danno", role: "CHAIR", emoji: "🧭", icon: "/board/danno-seat.svg", job: "Danno's teaching, from the approved principles only" },
  { key: "alex", name: "Alex, the Strategist", short: "Alex", role: "STRATEGIST", emoji: "🎯", icon: "/board/alex-strategist.svg", job: "direction, positioning, opportunity cost" },
  { key: "jordan", name: "Jordan, the Operator", short: "Jordan", role: "OPERATOR", emoji: "⚙️", icon: "/board/jordan-operator.svg", job: "feasibility, hours, sequence; owns the action steps" },
  { key: "morgan", name: "Morgan, the Antagonist", short: "Morgan", role: "ANTAGONIST", emoji: "⚡", icon: "/board/morgan-antagonist.svg", job: "assumptions, downside, reversibility" },
  { key: "riley", name: "Riley, the Customer Champion", short: "Riley", role: "CUSTOMER CHAMPION", emoji: "🤝", icon: "/board/riley-customer-champion.svg", job: "the client's client: trust, their words" },
];
/**
 * Danno's own Board may use the Edge Preset (rev 664 §1): labelled style advisors from his edge-preset-council skill, under the
 * same rules (no identity claims, no invented quotes). Never offered to clients.
 */
export const EDGE_SEATS: Seat[] = [
  { key: "tony", name: "Tony Robbins Advisor", short: "Tony Robbins Advisor", role: "STYLE ADVISOR", emoji: "🔥", icon: null, job: "a style advisor in the manner of Tony Robbins: state, standards, massive action" },
  { key: "dean", name: "Dean Graziosi Advisor", short: "Dean Graziosi Advisor", role: "STYLE ADVISOR", emoji: "🏠", icon: null, job: "a style advisor in the manner of Dean Graziosi: offers, simplicity, real-world execution" },
  { key: "igor", name: "Igor Pogany Advisor", short: "Igor Pogany Advisor", role: "STYLE ADVISOR", emoji: "🧠", icon: null, job: "a style advisor in the manner of Igor Pogany: positioning, community, long game" },
  { key: "jordan", name: "Jordan, the Operator", short: "Jordan", role: "OPERATOR", emoji: "⚙️", icon: "/board/jordan-operator.svg", job: "feasibility, hours, sequence; owns the action steps" },
  { key: "morgan", name: "Morgan, the Antagonist", short: "Morgan", role: "ANTAGONIST", emoji: "⚡", icon: "/board/morgan-antagonist.svg", job: "assumptions, downside, reversibility" },
];
export type Preset = "standard" | "edge";
/** The order the seats speak in (rev 698): Danno, Alex, Jordan, Morgan, Riley; the Edge Preset in its own order. */
export const speakingOrder = (preset: Preset): string[] => seatsFor(preset).map((s) => s.key);
export const seatsFor = (preset: Preset): Seat[] => (preset === "edge" ? EDGE_SEATS : SEATS);

/* ───────────────────────── The modes ───────────────────────── */


/* ───────────────────────── Danno's principles ───────────────────────── */

export type Principle = { title: string; body: string; goodFor: string };
/**
 * The pack's principles as editable rows (rev 664 §8): each "- **Title.** body" bullet under a section becomes one principle,
 * its section the "Good for" tag. The pack's own boundaries are rules, not principles, and stay in the prompt.
 */
export function principlesFromPack(md: string = DANNO_SOURCE_PACK_MD): Principle[] {
  const out: Principle[] = [];
  let section = "";
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^## (.+)$/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    if (!section || /boundaries/i.test(section)) continue;
    const b = lines[i].match(/^- \*\*(.+?)\*\*:?\s*(.*)$/);
    if (!b) continue;
    let body = b[2].trim();
    // A principle whose points are a sub-list (the three beliefs) keeps them, one per line.
    for (let j = i + 1; j < lines.length && /^\s{2,}\S/.test(lines[j]); j++) body += `\n${lines[j].trim()}`;
    out.push({ title: b[1].replace(/[.:]$/, "").trim(), body, goodFor: section });
  }
  return out;
}

/** The principles as Danno reads them: the pack's own header and boundaries around the coach's current rows. */
export function packText(principles: Principle[]): string {
  const header = DANNO_SOURCE_PACK_MD.split("\n## ")[0].trim();
  const boundaries = `## Boundaries for Danno${DANNO_SOURCE_PACK_MD.split("## Boundaries for Danno")[1] ?? ""}`.trim();
  const groups = new Map<string, Principle[]>();
  for (const p of principles) groups.set(p.goodFor || "Principles", [...(groups.get(p.goodFor || "Principles") ?? []), p]);
  const body = [...groups].map(([g, ps]) => `## ${g}\n\n${ps.map((p) => `- **${p.title}.** ${p.body.replace(/\n/g, "\n  ")}`).join("\n")}`).join("\n\n");
  return [header, body, boundaries].join("\n\n");
}

/* ───────────────────────── The skill for Claude (rev 664 §9) ───────────────────────── */

export const SKILL_FOLDER = "evolve-omega-board";
/**
 * The files of evolve-omega-board.skill, folder at the archive's root: the skill and the profile word for word, and the source
 * pack rebuilt around the coach's current principles (its own header and boundaries kept), so a download always matches the
 * Board in HelixOS today.
 */
export function boardSkillFiles(principles: Principle[]): { path: string; text: string }[] {
  return [
    { path: `${SKILL_FOLDER}/SKILL.md`, text: BOARD_SKILL_MD },
    { path: `${SKILL_FOLDER}/references/board-profile.md`, text: BOARD_PROFILE_MD },
    { path: `${SKILL_FOLDER}/references/danno-source-pack.md`, text: `${packText(principles)}\n` },
  ];
}


/* ───────────────────────── The answer ───────────────────────── */

export type Step = { do: string; by: string; takesMinutes: number; doneWhen: string; first5: string; dependsOn?: number | null };
/** One advisor's counsel and the one useful question they leave the member with (the skill's Board Mode). */
export type Card = { seat: string; text: string; question?: string | null };
export type BoardAnswer = {
  decision: string;
  assumptions: { text: string; guess: boolean }[];
  advisors: Card[];
  split: string;
  recommendation: string;
  steps: Step[];
  youDecide: string;
  /** Quick Vote: each seat's lean, one sentence. */
  votes?: { seat: string; option: string; why: string }[];
  /** Debate: what changed and what's still open. */
  changed?: string | null;
  unresolved?: string | null;
  /** Converge: the brief's extra parts. */
  strongestCase?: string | null;
  biggestRisk?: string | null;
  owner?: string | null;
  /** At most three clarifying questions, only when an answer would change the recommendation. */
  clarify?: string[];
};

/** The JSON the AI is asked for (the skill's layout, as fields). */
export const ANSWER_SHAPE = `Reply with JSON only, in this shape:
{"decision": "...", "assumptions": [{"text": "...", "guess": true}], "advisors": [{"seat": "danno|alex|jordan|morgan|riley", "text": "one short paragraph: the counsel and the reasoning", "question": "the one useful question this advisor asks"}], "split": "...", "recommendation": "...", "steps": [{"do": "...", "by": "YYYY-MM-DD", "takesMinutes": 45, "doneWhen": "...", "first5": "...", "dependsOn": null}], "youDecide": "...", "votes": [], "changed": null, "unresolved": null, "strongestCase": null, "biggestRisk": null, "owner": null, "clarify": []}
"votes" only for Quick Vote ({"seat", "option", "why"}); "changed" and "unresolved" only for Debate; "strongestCase", "biggestRisk" and "owner" only for Converge. "clarify" only when a missing fact would change the recommendation, at most three.`;

/**
 * The task for one ask: the skill and the profile word for word, Danno's current principles, the mode, the seats in
 * play (the Edge Preset's for Danno's own Board), the member's hours, today's date, and the JSON shape.
 */
export function boardTask(opts: { mode: Mode; focus?: string | null; preset: Preset; principles: Principle[]; hours: number; today: string; firstQuestion: boolean }): string {
  const seats = seatsFor(opts.preset);
  const roster = seats.map((s) => `${s.key}: ${s.name} (${s.job})`).join("\n");
  const edge = opts.preset === "edge" ? "\n\nThis is the coach's own Board on the Edge Preset. Its first three seats are labelled style advisors, not the people: they never claim to be them, never invent their quotes, stories or numbers, and speak only in the manner described. The same hard rules apply." : "";
  const who = opts.mode === "focus" && opts.focus ? `Only this advisor answers: ${opts.focus}.` : opts.mode === "board" && opts.firstQuestion ? "This is the decision's first question: all five advisors answer." : "Use the advisors who change the answer.";
  return [
    "MY_BOARD. You are the member's Evolve Omega Board inside HelixOS. Follow the skill and the profile below exactly; they are the spec.",
    `# The skill\n\n${BOARD_SKILL_MD}`,
    `# The board profile\n\n${BOARD_PROFILE_MD}`,
    `# Danno's approved principles\n\n${packText(opts.principles)}`,
    `# This answer\n\nMode: ${MODE_INFO[opts.mode].label} (${MODE_INFO[opts.mode].line})\n${who}\nThe seats, by key:\n${roster}${edge}\nToday is ${opts.today}. The member can give their business ${opts.hours} hours a week: the steps' total time never goes over it. Dates are real working days on or after today.\nThe member's HelixOS data follows under "What the Board can see". Use only it and what the member says; say what is missing instead of guessing. Prospects are first names and counts only. Never ask to add tasks: HelixOS offers that itself.`,
    ANSWER_SHAPE,
  ].join("\n\n");
}

/* ───────────────────────── The checks ───────────────────────── */

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const VAGUE = /^(think about|consider|work on|reflect on|explore|look into)\b/i;
const MONEY_OR_PCT = /\$\s?\d[\d,]*(\.\d+)?k?|\d[\d,]*(\.\d+)?\s?%/gi;
const digitsOf = (s: string) => s.replace(/[^\d.]/g, "").replace(/\.$/, "");
/** The member's next working day on or after a date (Monday to Friday). */
export function workingDay(d: string): string {
  let day = d;
  for (let i = 0; i < 3 && (weekday(day) === 0 || weekday(day) === 6); i++) day = addDays(day, 1);
  return day;
}
const PERSONAL = /\b(divorce|grief|depress|anxiety|panic|suicid|my health|illness|my marriage|my partner|burn ?out|mental)\b/i;
const PROFESSIONAL = /\b(tax|taxes|legal|lawyer|contract law|lawsuit|invest(ing|ment)? advice|medical|diagnos|therap)/i;
export const OFFICE_HOURS_LINE = "Bring this to Office Hours on Friday.";

export type Checked = { answer: BoardAnswer; notes: string[]; problem: string | null };
/**
 * The server's checks (rev 664 §4, §11, §12), not only asked of the AI: the seats known and distinct, all five on a decision's first
 * Board question (or the one in Focus), one split and one recommendation, one to three steps each with all five parts and a real
 * Do, dates moved to a working day on or after today, total time within the member's weekly hours (steps dropped from the end
 * until it fits, and said), no money or percentage in a card, assumption or recommendation that isn't in what the member gave,
 * the chair never claiming to be Danno and sending personal questions to Office Hours, and "You decide" always there.
 * A problem means the answer can't be shown as it is (the caller asks once more, then says so).
 */
export function checkAnswer(raw: unknown, ctx: { mode: Mode; focus?: string | null; preset: Preset; hours: number; today: string; firstQuestion: boolean; question: string; known: string; need?: string[] }): Checked {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const seatKeys = new Set(seatsFor(ctx.preset).map((s) => s.key));
  const knownMoney = new Set((`${ctx.known}\n${ctx.question}`.match(MONEY_OR_PCT) ?? []).map(digitsOf));
  const stripMoney = (text: string, where: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        const bad = (sentence.match(MONEY_OR_PCT) ?? []).filter((n) => !knownMoney.has(digitsOf(n)));
        if (bad.length) notes.push(`Left out of ${where}: a figure (${bad.join(", ")}) you didn't give.`);
        return !bad.length;
      })
      .join(" ")
      .trim();

  // The advisors: known seats, once each, never blended.
  const seen = new Set<string>();
  const advisors: Card[] = [];
  for (const a of Array.isArray(o.advisors) ? o.advisors : []) {
    const seat = str((a as Card)?.seat).toLowerCase();
    let text = str((a as Card)?.text);
    let question = str((a as Card)?.question);
    if (!seatKeys.has(seat) || seen.has(seat) || !text) continue;
    if (seat === "danno" || ctx.preset === "edge") {
      // Never a claim to be the person.
      text = text.split(/(?<=[.!?])\s+/).filter((s) => !/\b(I am|I'm|this is|as) (Danno|Tony|Dean|Igor)\b/i.test(s)).join(" ").trim();
    }
    text = stripMoney(text, SEATS.concat(EDGE_SEATS).find((s) => s.key === seat)?.name ?? seat);
    question = question ? stripMoney(question, `${seat}'s question`) : "";
    if (seat === "danno" && PERSONAL.test(ctx.question) && !text.includes(OFFICE_HOURS_LINE)) text = `${text} ${OFFICE_HOURS_LINE}`.trim();
    if (!text) continue;
    seen.add(seat);
    advisors.push({ seat, text, question: question || null });
  }
  let problem: string | null = null;
  if (ctx.mode === "focus") {
    const want = (ctx.focus ?? "").toLowerCase();
    const one = advisors.filter((a) => a.seat === want);
    if (!one.length) problem = "The advisor you asked for didn't answer.";
    advisors.splice(0, advisors.length, ...one);
  } else if (ctx.mode === "board" && ctx.firstQuestion && advisors.length !== 5) problem = `The Board gave ${advisors.length} of its five advisors.`;
  else if (!advisors.length && ctx.mode !== "quick_vote") problem = "No advisor answered.";
  // A check-in (rev 664 §6): Jordan shrinks a stuck step, Morgan asks about a dropped one; neither may be missing.
  const missing = (ctx.need ?? []).filter((k) => !advisors.some((a) => a.seat === k));
  if (!problem && missing.length) problem = `The check-in needs ${missing.map((k) => SEATS.find((x) => x.key === k)?.short ?? k).join(" and ")}.`;

  // The steps: one to three, all five parts, a real Do, working-day dates, within the hours.
  const steps: Step[] = [];
  for (const s of (Array.isArray(o.steps) ? o.steps : []).slice(0, 3)) {
    const x = s as Record<string, unknown>;
    const step: Step = { do: str(x.do), by: str(x.by), takesMinutes: Math.round(Number(x.takesMinutes)), doneWhen: str(x.doneWhen), first5: str(x.first5), dependsOn: Number.isInteger(x.dependsOn) ? (x.dependsOn as number) : null };
    if (!step.do || !step.doneWhen || !step.first5 || !(step.takesMinutes > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(step.by)) {
      notes.push(`Left out a step that was missing one of its five parts${step.do ? `: "${step.do}"` : ""}.`);
      continue;
    }
    if (VAGUE.test(step.do)) {
      notes.push(`Left out a step that wasn't a real action: "${step.do}".`);
      continue;
    }
    const by = workingDay(step.by < ctx.today ? ctx.today : step.by);
    if (by !== step.by) notes.push(`Moved "${step.do}" to ${by}, a working day.`);
    steps.push({ ...step, by });
  }
  if ((Array.isArray(o.steps) ? o.steps.length : 0) > 3) notes.push("Kept the first three steps; the Board gives three at most.");
  const budget = Math.max(0, Math.round(ctx.hours * 60));
  while (steps.length > 1 && steps.reduce((a, s) => a + s.takesMinutes, 0) > budget) {
    const cut = steps.pop()!;
    notes.push(`Jordan: dropped "${cut.do}" so the steps fit your ${ctx.hours} hours a week.`);
  }
  if (steps.length === 1 && steps[0].takesMinutes > budget) notes.push(`Jordan: this one step takes more than your ${ctx.hours} hours this week; shrink it or give it more time.`);
  if (!steps.length && ctx.mode !== "quick_vote" && ctx.mode !== "checkin") problem ??= "The Board didn't give a usable action step.";

  const assumptions = (Array.isArray(o.assumptions) ? o.assumptions : [])
    .map((a) => ({ text: stripMoney(str((a as { text?: unknown })?.text), "the assumptions"), guess: Boolean((a as { guess?: unknown })?.guess) }))
    .filter((a) => a.text)
    .slice(0, 6);
  const recommendation = stripMoney(str(o.recommendation), "the recommendation");
  if (!recommendation && ctx.mode !== "quick_vote") problem ??= "The Board didn't give a recommendation.";
  const split = str(o.split);
  if (PROFESSIONAL.test(ctx.question) && !/qualified|professional|accountant|lawyer|doctor/i.test(`${recommendation} ${advisors.map((a) => a.text).join(" ")}`)) notes.push("This touches legal, tax, financial or medical ground: check it with a qualified professional.");
  const votes = (Array.isArray(o.votes) ? o.votes : []).map((v) => ({ seat: str((v as { seat?: unknown }).seat).toLowerCase(), option: str((v as { option?: unknown }).option), why: str((v as { why?: unknown }).why) })).filter((v) => seatKeys.has(v.seat) && v.option);
  const clarify = (Array.isArray(o.clarify) ? o.clarify : []).map(str).filter(Boolean).slice(0, 3);
  return {
    answer: {
      decision: str(o.decision) || ctx.question,
      assumptions,
      advisors,
      split,
      recommendation,
      steps,
      youDecide: str(o.youDecide) || "You decide. This is your call.",
      votes,
      changed: str(o.changed) || null,
      unresolved: str(o.unresolved) || null,
      strongestCase: str(o.strongestCase) || null,
      biggestRisk: str(o.biggestRisk) || null,
      owner: str(o.owner) || null,
      clarify,
    },
    notes,
    problem,
  };
}

/** "Takes 45 min", "Takes 1 h 30 min". */

/** The answer read aloud: one sentence first, then the recommendation and the steps, numbered. */
export function spokenAnswer(a: BoardAnswer, seats: Seat[]): string {
  const name = (k: string) => seats.find((s) => s.key === k)?.name ?? k;
  const steps = a.steps.map((s, i) => `${i + 1}. ${s.do}, by ${s.by}, takes ${takesWords(s.takesMinutes)}. Done when: ${s.doneWhen}. First 5 minutes: ${s.first5}.`);
  return [
    `The Board recommends: ${a.recommendation || "no single path yet"}`,
    a.split ? `Where it splits: ${a.split}` : "",
    a.advisors.map((c) => `${name(c.seat)}: ${c.text}${c.question ? ` ${c.question}` : ""}`).join("\n"),
    steps.length ? `Your action steps:\n${steps.join("\n")}` : "",
    a.youDecide,
  ]
    .filter(Boolean)
    .join("\n\n");
}
