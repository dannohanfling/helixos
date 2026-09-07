/** Simple path: one stage at a time, must-do tasks first, at most 3 open at once. Extras stay out of sight. */

export type LibTask = { key: string; stageKey: string; order: number; name: string; points: number; priority: "must" | "should" | "nice" | "optional" };
export type Prog = { libraryTaskKey: string; status: "todo" | "submitted" | "revision" | "verified" };

export const OPEN_LIMIT = 3;

/**
 * Onboarding admin: the contract, the payment, the intake form, access confirmations and the kickoff call. By the time a client
 * is inside the app these are done or the coach's job, so they never lead the client-facing path. They stay in the library as
 * optional extras, visible on the whole map, never as "your next step".
 */
// Account setup, not client work: the agreement, payment, form, access checks, kickoff, and requesting access assets.
export const ADMIN_ONBOARDING_KEYS = new Set(["rec3EDSai6DGpoSuH", "recNzletnqB7Puu0A", "recCwbntdJ4Lx4dCN", "recQ9p5TpZUbE4UTe", "recKlRTN3LqILSJYe", "recROMPBY7WWLyW3e", "recPgnXs5n531z79L"]);

export function clientFacing<T extends LibTask>(library: T[]): T[] {
  return library.map((t) => (ADMIN_ONBOARDING_KEYS.has(t.key) ? { ...t, priority: "optional" as const } : t));
}

export function simplePath(stages: { key: string; order: number }[], rawLibrary: LibTask[], progress: Prog[]) {
  const library = clientFacing(rawLibrary);
  const status = new Map(progress.map((p) => [p.libraryTaskKey, p.status]));
  const st = (k: string) => status.get(k) ?? "todo";
  const ordered = stages.slice().sort((a, b) => a.order - b.order);
  for (const stage of ordered) {
    const tasks = library.filter((t) => t.stageKey === stage.key).sort((a, b) => a.order - b.order);
    const core = tasks.filter((t) => t.priority === "must");
    const path = core.length ? core : tasks.filter((t) => t.priority === "should");
    const done = path.filter((t) => st(t.key) === "verified");
    if (path.length && done.length === path.length) continue;
    const waiting = path.filter((t) => st(t.key) === "submitted");
    const fix = path.filter((t) => st(t.key) === "revision");
    const open = path.filter((t) => st(t.key) === "todo").slice(0, Math.max(0, OPEN_LIMIT - fix.length));
    const extras = tasks.filter((t) => !path.includes(t));
    return {
      stageKey: stage.key,
      now: [...fix, ...open],
      waiting,
      doneCount: done.length,
      pathCount: path.length,
      remaining: path.length - done.length - waiting.length - fix.length - open.length,
      extras: { total: extras.length, done: extras.filter((t) => st(t.key) === "verified").length, tasks: extras },
      allDone: false,
    };
  }
  const last = ordered[ordered.length - 1];
  return { stageKey: last?.key ?? "", now: [], waiting: [], doneCount: 0, pathCount: 0, remaining: 0, extras: { total: 0, done: 0, tasks: [] as LibTask[] }, allDone: true };
}

export const DESTINATION_STAGE_KEY = "launch-first-conversion-event";

/**
 * The one line that names where a client is and where the road goes: "Stage 1 of 7 · Week 1 · first conversion event
 * around Week 6". Weeks come from each stage's own expectedDuration; nothing is computed from the signup date.
 */
export function roadLine(stages: { key: string; order: number; name: string; expectedDuration: string | null }[], currentKey: string, allDone = false): string {
  const ordered = stages.slice().sort((a, b) => a.order - b.order);
  const n = ordered.length;
  if (allDone || !n) return "Every stage done.";
  const cur = ordered.find((s) => s.key === currentKey) ?? ordered[0];
  const dest = ordered.find((s) => s.key === DESTINATION_STAGE_KEY) ?? ordered.find((s) => /conversion event/i.test(s.name));
  const here = `Stage ${cur.order} of ${n}${cur.expectedDuration ? ` · ${cur.expectedDuration}` : ""}`;
  if (!dest) return here;
  if (cur.order < dest.order) return `${here} · first conversion event around ${dest.expectedDuration ?? `stage ${dest.order}`}`;
  if (cur.order === dest.order) return `${here} · this is the first conversion event`;
  return `${here} · first conversion event behind you`;
}
