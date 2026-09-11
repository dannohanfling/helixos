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

/** A stage the client is looking at, relative to the one they are in: behind them, theirs now, or still locked. */
export function stageRelation(stages: { key: string; order: number }[], currentKey: string, key: string): "past" | "current" | "future" {
  const cur = stages.find((s) => s.key === currentKey)?.order ?? 0;
  const at = stages.find((s) => s.key === key)?.order ?? cur;
  return at < cur ? "past" : at > cur ? "future" : "current";
}

/**
 * Stage 1's three tasks are bound to fields, not submissions: each completes itself when its field is saved, and the
 * stage completes when all three are, which is what its exit criteria say. Order: promise, audience, goal.
 */
export type FieldTaskFacts = { bigPromise: string | null; audience: string | null; goalTarget: number };
export const FIELD_TASKS: Record<string, { href: string; done: (f: FieldTaskFacts) => boolean; where: string }> = {
  "field-big-promise": { href: "/settings#you", where: "Settings", done: (f) => Boolean(f.bigPromise?.trim()) },
  "field-audience": { href: "/settings#you", where: "Settings", done: (f) => Boolean(f.audience?.trim()) },
  "field-revenue-goal": { href: "/settings#goal", where: "Settings", done: (f) => f.goalTarget > 0 },
};
export const isFieldTask = (key: string) => key in FIELD_TASKS;

/**
 * A task whose work lives in a section of the app: the card links there and shows what the client has made, beside the
 * box they tick themselves. Never auto-ticked: submitting is where a client says they finished rather than started, and a
 * pathway where some boxes tick themselves and most do not cannot be predicted.
 */
export const SECTION_TASKS: Record<string, { href: string; where: string; one: string; many: string }> = {
  recA3OidbU8gUYW8x: { href: "/magnets", where: "Lead magnets", one: "lead magnet", many: "lead magnets" },
};
export function sectionCountLine(key: string, count: number): string | null {
  const t = SECTION_TASKS[key];
  if (!t) return null;
  return count === 0 ? `You have no ${t.many} yet.` : `You have ${count} ${count === 1 ? t.one : t.many}.`;
}
export function fieldTaskStatus(f: FieldTaskFacts): Record<string, boolean> {
  return Object.fromEntries(Object.entries(FIELD_TASKS).map(([k, t]) => [k, t.done(f)]));
}

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
