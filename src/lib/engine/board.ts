/**
 * My Board (rev 664), the pure parts: the five seats, the modes, Danno's principles seeded from the pack, the prompt
 * built from Cowork's spec (docs/board/, copied in src/content/board-spec.ts), and the checks the server applies to every answer
 * before the member sees it. The spec is ported, never re-invented: the voices, modes and hard rules are the files' own words.
 * Nothing here reads the database or calls the AI.
 */
import { addDays, weekday } from "@/lib/dates";
import { BOARD_PROFILE_MD, BOARD_SKILL_MD, DANNO_SOURCE_PACK_MD } from "@/content/board-spec";
import { MODE_INFO, takesWords, type Mode } from "@/lib/engine/board-view";
import { personOf, withoutPersonClaims } from "@/lib/engine/board-seats";
import type { BoardSeatUsed } from "@/db/schema";
export { MODES, MODE_INFO, SEAT_SPOTS, SKILL_INSTALL_STEPS, SPEAK_MS, takesWords, type Mode } from "@/lib/engine/board-view";

/* ───────────────────────── The seats ───────────────────────── */

export const SEAT_KEYS = ["danno", "alex", "jordan", "morgan", "riley"] as const;
export type SeatKey = (typeof SEAT_KEYS)[number];
export type Seat = {
  key: string;
  name: string;
  emoji: string;
  icon: string | null;
  job: string;
  short: string;
  role: string;
  /** Rev 756: the seat that owns the action steps, the profile the engine reads, and what the answer records. */
  operator?: boolean;
  profile?: string;
  kind?: BoardSeatUsed["kind"];
  id?: string | null;
  version?: number;
  paused?: boolean;
  retired?: boolean;
};
/**
 * The classic Board (rev 664 §1), with Cowork's seat icons, in chair order (rev 756): Danno at the head, then left, right, front
 * left and front right. It is every member's council until they choose their own.
 */
export const SEATS: Seat[] = [
  { key: "danno", name: "Danno", short: "Danno", role: "CHAIR", emoji: "🧭", icon: "/board/danno-seat.svg", job: "Danno's teaching, from the approved principles only", kind: "chair" },
  { key: "alex", name: "Alex, the Strategist", short: "Alex", role: "STRATEGIST", emoji: "🎯", icon: "/board/alex-strategist.svg", job: "direction, positioning, opportunity cost", kind: "archetype" },
  { key: "jordan", name: "Jordan, the Operator", short: "Jordan", role: "OPERATOR", emoji: "⚙️", icon: "/board/jordan-operator.svg", job: "feasibility, hours, sequence; owns the action steps", kind: "archetype", operator: true },
  { key: "riley", name: "Riley, the Customer Champion", short: "Riley", role: "CUSTOMER CHAMPION", emoji: "🤝", icon: "/board/riley-customer-champion.svg", job: "the client's client: trust, their words", kind: "archetype" },
  { key: "morgan", name: "Morgan, the Antagonist", short: "Morgan", role: "ANTAGONIST", emoji: "⚡", icon: "/board/morgan-antagonist.svg", job: "assumptions, downside, reversibility", kind: "archetype" },
];
/** The classic five, whatever order they sit in: the spec's own skill and profile apply word for word. */
export const isClassic = (seats: Seat[]) => seats.length === 5 && SEATS.every((c) => seats.some((s) => s.key === c.key && !s.profile));
/** The seats as the room gets them: names, roles and chairs, never the profiles the engine reads. */
export const forRoom = (seats: Seat[]): Seat[] => seats.map((s) => ({ ...s, profile: undefined }));
/**
 * Danno's own Board may use the Edge Preset (rev 664 §1): labelled style advisors from his edge-preset-council skill, under the
 * same rules (no identity claims, no invented quotes). Never offered to clients.
 */
export const EDGE_SEATS: Seat[] = [
  { key: "tony", name: "Tony Robbins Advisor", short: "Tony Robbins Advisor", role: "STYLE ADVISOR", emoji: "🔥", icon: null, job: "a style advisor in the manner of Tony Robbins: state, standards, massive action" },
  { key: "dean", name: "Dean Graziosi Advisor", short: "Dean Graziosi Advisor", role: "STYLE ADVISOR", emoji: "🏠", icon: null, job: "a style advisor in the manner of Dean Graziosi: offers, simplicity, real-world execution" },
  { key: "igor", name: "Igor Pogany Advisor", short: "Igor Pogany Advisor", role: "STYLE ADVISOR", emoji: "🧠", icon: null, job: "a style advisor in the manner of Igor Pogany: positioning, community, long game" },
  { key: "jordan", name: "Jordan, the Operator", short: "Jordan", role: "OPERATOR", emoji: "⚙️", icon: "/board/jordan-operator.svg", job: "feasibility, hours, sequence; owns the action steps", kind: "archetype", operator: true },
  { key: "morgan", name: "Morgan, the Antagonist", short: "Morgan", role: "ANTAGONIST", emoji: "⚡", icon: "/board/morgan-antagonist.svg", job: "assumptions, downside, reversibility", kind: "archetype" },
];
export type Preset = "standard" | "edge";
/** The order the seats speak in (rev 756): chair, left, right, front left, front right; the Edge Preset in its own order. */
export const speakingOrder = (preset: Preset): string[] => seatsFor(preset).map((s) => s.key);
/** The fixed councils, for answers saved before a council was recorded with them (rev 756). */
export const seatsFor = (preset: Preset): Seat[] => (preset === "edge" ? EDGE_SEATS : SEATS);
/** The seats an answer sat with: its own record (rev 756), else the fixed council of its preset. */
export function seatsOfDecision(d: { preset: Preset; seats?: BoardSeatUsed[] | null }): Seat[] {
  if (!d.seats?.length) return seatsFor(d.preset);
  return d.seats.map((u) => {
    const known = [...SEATS, ...EDGE_SEATS].find((x) => x.key === u.key);
    return { key: u.key, name: u.name, short: u.short, role: u.role, emoji: known?.emoji ?? "", icon: known?.icon ?? null, job: known?.job ?? "", kind: u.kind, operator: u.operator, id: u.id, version: u.version, paused: u.paused, retired: u.retired };
  });
}
/** What an answer records about each seat (rev 756 §5). */
export const seatsUsed = (seats: Seat[]): BoardSeatUsed[] => seats.map((s) => ({ id: s.id ?? null, key: s.key, name: s.name, short: s.short, role: s.role, kind: s.kind ?? "archetype", version: s.version ?? 1, operator: Boolean(s.operator), ...(s.paused ? { paused: true } : {}), ...(s.retired ? { retired: true } : {}) }));
/** The seat that owns the action steps: the first operator after the chair. */
export const operatorSeat = (seats: Seat[]): Seat | null => seats.find((s) => s.operator) ?? null;

/** The style-advisor rule (rev 756 §1) that replaces the spec's "no real-person seats" line when a council has expert seats. */
const STYLE_RULE =
  'Seats named "{Name} style" are style advisors inspired by that person\'s public work, not the person. They never say "I am {Name}", never quote the person, and never claim private knowledge or an endorsement. Anything beyond a seat\'s listed frameworks and the member\'s context is labelled "my read".';
/**
 * The skill and the profile for a council (rev 756 §5): the spec's own files word for word for the classic five; otherwise the
 * same files with the council's names in the description and the hard rules, the style-advisor rule in place of "no real-person
 * seats", and a profile built from Danno's block plus each seat's library profile, with the coverage rule kept.
 */
export function councilSpec(seats: Seat[]): { skill: string; profile: string } {
  if (isClassic(seats)) return { skill: BOARD_SKILL_MD, profile: BOARD_PROFILE_MD };
  // The Edge Preset (Danno's own Board) keeps the spec's files, with its style advisors' library profiles after them.
  if (!seats.some((s) => s.key === "danno")) {
    const styled = seats.filter((s) => s.profile).map((s) => s.profile!);
    return { skill: BOARD_SKILL_MD, profile: styled.length ? `${BOARD_PROFILE_MD}\n# The Edge Preset's style advisors\n\n${styled.join("\n\n")}\n` : BOARD_PROFILE_MD };
  }
  const archetypeBlock = (name: string) => {
    const b = BOARD_PROFILE_MD.split("\n## ").find((x) => x.startsWith(`${name} `));
    return b ? `## ${b.trim()}` : null;
  };
  const named = seats.map((s) => s.name).join(", ");
  const skill = BOARD_SKILL_MD.replace(/five advisors \(Danno, Alex the Strategist, Jordan the Operator, Morgan the Antagonist, Riley the Customer Champion\)/, `five advisors (${named})`)
    .replace("- Keep the names and roles: Danno, Alex the Strategist, Jordan the Operator, Morgan the Antagonist, Riley the Customer Champion.", `- Keep the names and roles: ${named}.`)
    .replace(/- No celebrity or real-person seats other than Danno\.[^\n]*/, `- ${STYLE_RULE}`);
  const danno = `## ${BOARD_PROFILE_MD.split("\n## ")[1].trim()}`;
  const op = operatorSeat(seats);
  const profile = [
    "# Board Profile\n\nThe Board always contains exactly these five advisors.",
    danno,
    ...seats.filter((s) => s.key !== "danno").map((s) => s.profile ?? archetypeBlock(s.name) ?? `## ${s.name}\n\n- **Purpose:** ${s.job}`),
    `## Coverage check\n\n${op ? `${op.name} is the operator: they own the action steps.` : "Danno turns the advice into the action steps."} If no seat challenges risk, the recommendation still names the main risk in one line.`,
  ].join("\n\n");
  return { skill, profile: `${profile}\n` };
}

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
export function boardSkillFiles(principles: Principle[], seats: Seat[] = SEATS): { path: string; text: string }[] {
  // The member's current council (rev 756 §5), not the fixed five.
  const spec = councilSpec(seats);
  return [
    { path: `${SKILL_FOLDER}/SKILL.md`, text: spec.skill },
    { path: `${SKILL_FOLDER}/references/board-profile.md`, text: spec.profile },
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

/** The JSON the AI is asked for (the skill's layout, as fields), with the council's own seat keys. */
export const answerShape = (keys: string[]) => ANSWER_SHAPE.replace("danno|alex|jordan|morgan|riley", keys.join("|"));
export const ANSWER_SHAPE = `Reply with JSON only, in this shape:
{"decision": "...", "assumptions": [{"text": "...", "guess": true}], "advisors": [{"seat": "danno|alex|jordan|morgan|riley", "text": "one short paragraph: the counsel and the reasoning", "question": "the one useful question this advisor asks"}], "split": "...", "recommendation": "...", "steps": [{"do": "...", "by": "YYYY-MM-DD", "takesMinutes": 45, "doneWhen": "...", "first5": "...", "dependsOn": null}], "youDecide": "...", "votes": [], "changed": null, "unresolved": null, "strongestCase": null, "biggestRisk": null, "owner": null, "clarify": []}
"votes" only for Quick Vote ({"seat", "option", "why"}); "changed" and "unresolved" only for Debate; "strongestCase", "biggestRisk" and "owner" only for Converge. "clarify" only when a missing fact would change the recommendation, at most three.`;

/**
 * The task for one ask: the skill and the profile word for word, Danno's current principles, the mode, the seats in
 * play (the Edge Preset's for Danno's own Board), the member's hours, today's date, and the JSON shape.
 */
export function boardTask(opts: { mode: Mode; focus?: string | null; preset: Preset; seats?: Seat[]; principles: Principle[]; hours: number; today: string; firstQuestion: boolean }): string {
  const seats = opts.seats ?? seatsFor(opts.preset);
  const spec = councilSpec(seats);
  const op = operatorSeat(seats);
  const roster = seats.map((s) => `${s.key}: ${s.name} (${s.job})${s.operator && s === op ? " — the operator: owns the action steps" : ""}`).join("\n");
  const edge = opts.preset === "edge" ? "\n\nThis is the coach's own Board on the Edge Preset. Its first three seats are labelled style advisors, not the people: they never claim to be them, never invent their quotes, stories or numbers, and speak only in the manner described. The same hard rules apply." : "";
  const who = opts.mode === "focus" && opts.focus ? `Only this advisor answers: ${opts.focus}.` : opts.mode === "board" && opts.firstQuestion ? "This is the decision's first question: all five advisors answer." : "Use the advisors who change the answer.";
  return [
    "MY_BOARD. You are the member's Evolve Omega Board inside HelixOS. Follow the skill and the profile below exactly; they are the spec.",
    `# The skill\n\n${spec.skill}`,
    `# The board profile\n\n${spec.profile}`,
    `# Danno's approved principles\n\n${packText(opts.principles)}`,
    `# This answer\n\nMode: ${MODE_INFO[opts.mode].label} (${MODE_INFO[opts.mode].line})\n${who}\nThe seats, by key:\n${roster}${edge}\nToday is ${opts.today}. The member can give their business ${opts.hours} hours a week: the steps' total time never goes over it. Dates are real working days on or after today.\nThe member's HelixOS data follows under "What the Board can see". Use only it and what the member says; say what is missing instead of guessing. Prospects are first names and counts only. Never ask to add tasks: HelixOS offers that itself.`,
    answerShape(seats.map((s) => s.key)),
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
export function checkAnswer(raw: unknown, ctx: { mode: Mode; focus?: string | null; preset: Preset; seats?: Seat[]; hours: number; today: string; firstQuestion: boolean; question: string; known: string; need?: string[] }): Checked {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notes: string[] = [];
  const council = ctx.seats ?? seatsFor(ctx.preset);
  const seatKeys = new Set(council.map((s) => s.key));
  const seatName = (k: string) => council.find((s) => s.key === k)?.name ?? k;
  const opShort = operatorSeat(council)?.short ?? "Danno";
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
    // A style advisor (rev 756 §1): never "I am {Name}", never a quote put in the person's mouth.
    const kind = council.find((s) => s.key === seat)?.kind;
    if (kind === "expert" || kind === "custom" || kind === "edge") {
      const r = withoutPersonClaims(text, seatName(seat));
      if (r.cut) notes.push(`Left out a line where ${seatName(seat)} spoke as or quoted ${personOf(seatName(seat))}: style advisors never do.`);
      text = r.text;
      if (question) question = withoutPersonClaims(question, seatName(seat)).text;
    }
    text = stripMoney(text, seatName(seat));
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
  } else if (ctx.mode === "board" && ctx.firstQuestion && advisors.length !== council.length) problem = `The Board gave ${advisors.length} of its five advisors.`;
  else if (!advisors.length && ctx.mode !== "quick_vote") problem = "No advisor answered.";
  // A check-in (rev 664 §6): Jordan shrinks a stuck step, Morgan asks about a dropped one; neither may be missing.
  const missing = (ctx.need ?? []).filter((k) => !advisors.some((a) => a.seat === k));
  if (!problem && missing.length) problem = `The check-in needs ${missing.map((k) => council.find((x) => x.key === k)?.short ?? k).join(" and ")}.`;

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
    notes.push(`${opShort}: dropped "${cut.do}" so the steps fit your ${ctx.hours} hours a week.`);
  }
  if (steps.length === 1 && steps[0].takesMinutes > budget) notes.push(`${opShort}: this one step takes more than your ${ctx.hours} hours this week; shrink it or give it more time.`);
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
