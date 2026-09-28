/**
 * The weekly intention, the 3-1-3 (handoff rev 124): ONE word to embody this week, THREE trackable key results, ONE initiative
 * toward the bigger goal, THREE tasks that move the needle. Set from Monday; the tasks become the week's Tasks; the key results
 * get a done / not done at the end of the week. Pure: dates are the member's own "YYYY-MM-DD".
 */
import { addDays, startOfWeek, weekday } from "@/lib/dates";

/** The week an intention belongs to: its Monday. */
export const weekOf = (today: string): string => startOfWeek(today);
/** The Friday of a week: the tasks' due date. */
export const fridayOf = (today: string): string => addDays(startOfWeek(today), 4);
/** When the week's tasks are due: that Friday, or today when the week is set on the weekend, so none starts out overdue. */
export const tasksDueOn = (today: string): string => (fridayOf(today) < today ? today : fridayOf(today));

export type IntentionState = { reviewedAt: string | null } | null | undefined;
/**
 * What Today shows for the week: the "Set your week" card until it is set (any day, from Monday); once set, the week at the top,
 * and from Friday to Sunday the done / not done on the key results until they are marked.
 */
export function intentionPrompt(today: string, week: IntentionState): "set" | "review" | "shown" {
  if (!week) return "set";
  const d = weekday(today);
  return (d === 5 || d === 6 || d === 0) && !week.reviewedAt ? "review" : "shown";
}

/** Not set by Tuesday: from Tuesday on, a member with no 3-1-3 for the week shows under the coach's quiet list. */
export const lateForWeek = (today: string): boolean => weekday(today) !== 1;

/* ── Key results are results (rev 158): trackable (a number) and what the tasks produce, not the tasks themselves. ── */

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, fifty: 50, hundred: 100 };
const NUMBER_TOKEN = new RegExp(`\\$?\\d[\\d,]*(?:\\.\\d+)?|\\b(?:${Object.keys(NUMBER_WORDS).join("|")})\\b`, "i");
/** The number a key result counts to ("3 booked calls" → 3, "ten new leads" → 10), or null when it has none. */
export function targetOf(text: string): number | null {
  const m = text.match(NUMBER_TOKEN);
  if (!m) return null;
  const w = NUMBER_WORDS[m[0].toLowerCase()];
  if (w) return w;
  const n = Number(m[0].replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
export const NEEDS_NUMBER = "Add a number you can count, like 3 booked calls.";
/** Activity verbs: a key result that starts with one reads as a task (rev 158). A nudge, never a block. */
export const ACTIVITY_VERBS = ["post", "film", "record", "write", "send", "email", "dm", "call", "reach out", "create", "publish", "go live", "share"] as const;
const TASK_START = new RegExp(`^(?:${ACTIVITY_VERBS.map((v) => v.replace(" ", "\\s+")).join("|")})\\b`, "i");
export const soundsLikeTask = (text: string): boolean => TASK_START.test(text.trim());
export const TASK_NUDGE = "That sounds like a task. What result do you want from it?";
/**
 * "Move it to my tasks": the key result's words go into the first free task slot and the key result empties, so the member can
 * write the result. With no free slot nothing moves.
 */
export function moveToTasks(keyResults: string[], tasks: string[], i: number): { keyResults: string[]; tasks: string[] } | null {
  const free = tasks.findIndex((t) => !t.trim());
  if (free < 0 || !keyResults[i]?.trim()) return null;
  const nextTasks = tasks.slice();
  nextTasks[free] = keyResults[i].trim();
  const nextKr = keyResults.slice();
  nextKr[i] = "";
  return { keyResults: nextKr, tasks: nextTasks };
}
/** The Friday check against the number set: "2 of 3 booked calls from my posts". Done means they hit the number. */
export function krProgress(text: string, actual: number | null | undefined): string {
  const target = targetOf(text);
  if (target === null || actual === null || actual === undefined) return text;
  return text.replace(NUMBER_TOKEN, `${actual} of ${text.match(NUMBER_TOKEN)![0]}`);
}
export const hitTarget = (text: string, actual: number): boolean => {
  const target = targetOf(text);
  return target !== null && actual >= target;
};

export type IntentionInput = { word: string; keyResults: string[]; initiative: string; tasks: string[] };
/**
 * The form as saved: trimmed, the optional third key result and task dropped when blank. Everything is required except a third
 * key result or task. The word can be a short phrase ("Show up daily", rev 160), up to WORD_MAX characters. A refusal names the
 * field it is about, so the form can say so beside it.
 */
export const WORD_MAX = 40;
export function readIntention(raw: { word: string; kr: string[]; initiative: string; tasks: string[] }): { value: IntentionInput } | { error: string; field?: string } {
  const word = raw.word.trim();
  const keyResults = raw.kr.map((k) => k.trim());
  const tasks = raw.tasks.map((t) => t.trim());
  const initiative = raw.initiative.trim();
  if (!word) return { error: "Choose one word (or a short phrase) for your week.", field: "word" };
  if (word.length > WORD_MAX) return { error: `Keep your word to a short phrase, ${WORD_MAX} characters or fewer.`, field: "word" };
  if (!keyResults[0] || !keyResults[1]) return { error: "Write at least two key results you can track.", field: keyResults[0] ? "kr2" : "kr1" };
  const noNumber = keyResults.findIndex((k) => k && targetOf(k) === null);
  if (noNumber >= 0) return { error: NEEDS_NUMBER, field: `kr${noNumber + 1}` };
  if (!initiative) return { error: "Write the one initiative that moves your bigger goal.", field: "initiative" };
  if (!tasks[0] || !tasks[1]) return { error: "Write at least two tasks that move the needle.", field: tasks[0] ? "task2" : "task1" };
  return { value: { word, keyResults: keyResults.slice(0, 3).filter(Boolean), initiative, tasks: tasks.slice(0, 3).filter(Boolean) } };
}

/** "2 of 3 key results done", once marked. */
export const keyResultTally = (done: (boolean | null)[]): string => `${done.filter(Boolean).length} of ${done.length} key results done`;

/** The month's intention is asked for during the first week of the month only (rev 157); after that it's optional, with no badge. */
export const MONTH_ASK_DAYS = 7;
export type IntentionsDue = "week" | "check" | "month" | "feedback";
/**
 * What is due on the Intentions page, for the badge in the menu (rev 157): the week from Monday until it's set, the Friday to
 * Sunday check until it's marked, the month on days 1 to 7 until it's set, and the feedback in its window until it's sent.
 */
export function intentionsDue(today: string, s: { week: IntentionState; monthSet: boolean; feedbackMonth: string | null; feedbackGiven: boolean }): IntentionsDue[] {
  const out: IntentionsDue[] = [];
  const prompt = intentionPrompt(today, s.week);
  if (prompt === "set") out.push("week");
  if (prompt === "review") out.push("check");
  if (!s.monthSet && Number(today.slice(8, 10)) <= MONTH_ASK_DAYS) out.push("month");
  if (s.feedbackMonth && !s.feedbackGiven) out.push("feedback");
  return out;
}
