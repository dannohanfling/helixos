/**
 * Business goals (rev 530, BG1): a linked plan for every client. Goal, then key results, then initiatives, then tasks, with
 * KPIs as measures (BG2). Pure: the records and links go in, the tree, the counts and the table's filtering come out. Nothing
 * here is Body's Health goals; the two never share a table, a name or a page.
 */
import type { PlanKind, PlanStatus } from "@/db/schema";

export type PlanRow = { id: string; kind: PlanKind; title: string; status: PlanStatus; owner: string | null; dueDate: string | null; notes: string | null; pathwayStage: string | null; order: number; budget: number | null; hireTrigger: string | null; primary: boolean; archivedAt: string | null; createdAt: string };
export type LinkRow = { fromId: string; toKind: "record" | "task"; toId: string };
export type TaskRef = { id: string; title: string; status: string; dueDate: string | null };

export const KIND_LABEL: Record<PlanKind, string> = { goal: "Goal", key_result: "Key result", initiative: "Initiative" };
export const KIND_PLURAL: Record<PlanKind, string> = { goal: "Goals", key_result: "Key results", initiative: "Initiatives" };
export const STATUS_LABEL: Record<PlanStatus, string> = { not_started: "Not started", on_track: "On track", behind: "Behind", done: "Done", dropped: "Dropped" };
export const STATUS_TONE: Record<PlanStatus, "neutral" | "good" | "warn" | "accent"> = { not_started: "neutral", on_track: "good", behind: "warn", done: "accent", dropped: "neutral" };
/** What a record of one kind links down to: the kind under it, or a task. */
export const CHILD_OF: Record<PlanKind, PlanKind | "task"> = { goal: "key_result", key_result: "initiative", initiative: "task" };
/** What a record of one kind links up to. */
export const PARENT_OF: Record<PlanKind, PlanKind | null> = { goal: null, key_result: "goal", initiative: "key_result" };

/** The record's own links, both ways: what sits under it and what it sits under. */
export function linksOf(id: string, links: readonly LinkRow[]): { down: LinkRow[]; up: LinkRow[] } {
  return { down: links.filter((l) => l.fromId === id), up: links.filter((l) => l.toKind === "record" && l.toId === id) };
}

export type InitiativeNode = { record: PlanRow; tasks: TaskRef[]; done: number };
export type KeyResultNode = { record: PlanRow; initiatives: InitiativeNode[] };
export type GoalNode = { record: PlanRow; keyResults: KeyResultNode[]; /** Of its key results, how many read on track or done (BG2 reads pace). */ onPace: number };
export type PlanTree = { goals: GoalNode[]; /** Key results and initiatives linked to no goal or key result: shown under "Not yet linked". */ loose: PlanRow[] };

const byOrder = (a: PlanRow, b: PlanRow) => a.order - b.order || a.createdAt.localeCompare(b.createdAt);
const live = (r: PlanRow) => !r.archivedAt;

/** The tree: each goal, its key results, their initiatives with task counts; the primary goal first. */
export function planTree(records: readonly PlanRow[], links: readonly LinkRow[], tasks: readonly TaskRef[]): PlanTree {
  const rows = records.filter(live);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const childrenOf = (id: string, kind: PlanKind): PlanRow[] => links.filter((l) => l.fromId === id && l.toKind === "record").map((l) => byId.get(l.toId)).filter((r): r is PlanRow => Boolean(r) && r!.kind === kind).sort(byOrder);
  const tasksOf = (id: string): TaskRef[] => links.filter((l) => l.fromId === id && l.toKind === "task").map((l) => taskById.get(l.toId)).filter((t): t is TaskRef => Boolean(t));
  const initiative = (r: PlanRow): InitiativeNode => { const t = tasksOf(r.id); return { record: r, tasks: t, done: t.filter((x) => x.status === "done").length }; };
  const keyResult = (r: PlanRow): KeyResultNode => ({ record: r, initiatives: childrenOf(r.id, "initiative").map(initiative) });
  const goals = rows.filter((r) => r.kind === "goal").sort((a, b) => Number(b.primary) - Number(a.primary) || byOrder(a, b)).map((g) => { const krs = childrenOf(g.id, "key_result").map(keyResult); return { record: g, keyResults: krs, onPace: krs.filter((k) => k.record.status === "on_track" || k.record.status === "done").length }; });
  const placed = new Set<string>();
  for (const g of goals) for (const k of g.keyResults) { placed.add(k.record.id); for (const i of k.initiatives) placed.add(i.record.id); }
  const loose = rows.filter((r) => r.kind !== "goal" && !placed.has(r.id)).sort(byOrder);
  return { goals, loose };
}

export type TableFilter = { kind?: PlanKind | ""; status?: PlanStatus | ""; owner?: string; dueBefore?: string; stage?: string };
/** The table's rows: live records, filtered by kind, status, owner (a word in the name), due on or before a date, and stage. */
export function tableRows(records: readonly PlanRow[], f: TableFilter): PlanRow[] {
  const owner = (f.owner ?? "").trim().toLowerCase();
  const stage = (f.stage ?? "").trim().toLowerCase();
  return records
    .filter(live)
    .filter((r) => (!f.kind || r.kind === f.kind) && (!f.status || r.status === f.status) && (!owner || (r.owner ?? "").toLowerCase().includes(owner)) && (!f.dueBefore || (r.dueDate !== null && r.dueDate <= f.dueBefore)) && (!stage || (r.pathwayStage ?? "").toLowerCase().includes(stage)))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || byOrder(a, b));
}

/** The coach's one line (read-only, the client page): goals, key results on pace, initiatives not started. */
export function coachSummary(tree: PlanTree): { goals: number; keyResults: number; onPace: number; initiatives: number; notStarted: number } {
  const krs = tree.goals.flatMap((g) => g.keyResults);
  const inits = krs.flatMap((k) => k.initiatives);
  return { goals: tree.goals.length, keyResults: krs.length, onPace: tree.goals.reduce((a, g) => a + g.onPace, 0), initiatives: inits.length, notStarted: inits.filter((i) => i.record.status === "not_started").length };
}

/** A link is allowed only down one level: goal to key result, key result to initiative, initiative to task. */
export function linkAllowed(from: Pick<PlanRow, "kind">, to: Pick<PlanRow, "kind"> | "task"): boolean {
  return to === "task" ? from.kind === "initiative" : CHILD_OF[from.kind] === to.kind;
}
