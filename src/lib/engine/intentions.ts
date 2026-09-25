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

export type IntentionInput = { word: string; keyResults: string[]; initiative: string; tasks: string[] };
/**
 * The form as saved: trimmed, the optional third key result and task dropped when blank. Everything is required except a third
 * key result or task. The word is one word (a hyphen is fine).
 */
export function readIntention(raw: { word: string; kr: string[]; initiative: string; tasks: string[] }): { value: IntentionInput } | { error: string } {
  const word = raw.word.trim();
  const keyResults = raw.kr.map((k) => k.trim());
  const tasks = raw.tasks.map((t) => t.trim());
  const initiative = raw.initiative.trim();
  if (!word) return { error: "Choose one word for your week." };
  if (/\s/.test(word)) return { error: "Your word is one word." };
  if (!keyResults[0] || !keyResults[1]) return { error: "Write at least two key results you can track." };
  if (!initiative) return { error: "Write the one initiative that moves your bigger goal." };
  if (!tasks[0] || !tasks[1]) return { error: "Write at least two tasks that move the needle." };
  return { value: { word, keyResults: keyResults.slice(0, 3).filter(Boolean), initiative, tasks: tasks.slice(0, 3).filter(Boolean) } };
}

/** "2 of 3 key results done", once marked. */
export const keyResultTally = (done: (boolean | null)[]): string => `${done.filter(Boolean).length} of ${done.length} key results done`;
