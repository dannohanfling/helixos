/**
 * Coach notes become work in the client's app. The task-creation path is shared: a 1:1 call note today, a recorded group
 * session later, each with its own source so the client sees where a task came from.
 */

export const TASK_SOURCES = {
  manual: "manual",
  coachCall: "coach_call",
} as const;
export type TaskSource = (typeof TASK_SOURCES)[keyof typeof TASK_SOURCES];

export type AssignedTask = {
  title: string;
  details?: string | null;
  category?: "sales" | "content" | "community" | "system" | "admin" | "fulfillment";
  urgency?: "top3" | "high" | "medium" | "low";
  dueDate?: string | null;
  points?: number;
};

export const MAX_TASKS_PER_NOTE = 10;

/** One task per non-empty line; leading bullets, dashes and numbering are dropped; duplicates and blanks are ignored. */
export function parseTaskLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line.slice(0, 200));
    if (out.length >= MAX_TASKS_PER_NOTE) break;
  }
  return out;
}

/** How a task's origin reads to the client. Plain, dated, no coaching voice. */
export function originLabel(source: string, date: string | null, formatDate: (d: string) => string): string | null {
  if (source === TASK_SOURCES.coachCall) return date ? `From your call on ${formatDate(date)}` : "From your call";
  return null;
}
