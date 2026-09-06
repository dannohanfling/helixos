/** Simple path: one stage at a time, must-do tasks first, at most 3 open at once. Extras stay out of sight. */

export type LibTask = { key: string; stageKey: string; order: number; name: string; points: number; priority: "must" | "should" | "nice" | "optional" };
export type Prog = { libraryTaskKey: string; status: "todo" | "submitted" | "revision" | "verified" };

export const OPEN_LIMIT = 3;

export function simplePath(stages: { key: string; order: number }[], library: LibTask[], progress: Prog[]) {
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
