import { describe, expect, it } from "vitest";
import { CHILD_OF, PARENT_OF, coachSummary, linkAllowed, linksOf, planTree, tableRows, type LinkRow, type PlanRow, type TaskRef } from "../plan";

/** Business goals (BG1): the tree from records and links, the roll-ups, the table's filters, and which links are allowed. */
const row = (over: Partial<PlanRow> & Pick<PlanRow, "id" | "kind" | "title">): PlanRow => ({ status: "not_started", owner: null, dueDate: null, notes: null, pathwayStage: null, order: 0, budget: null, hireTrigger: null, primary: false, archivedAt: null, createdAt: "2026-10-01T00:00:00.000Z", ...over });
const records: PlanRow[] = [
  row({ id: "g2", kind: "goal", title: "Launch the group program", order: 2 }),
  row({ id: "g1", kind: "goal", title: "Cash collected this month", primary: true, status: "on_track", order: 5 }),
  row({ id: "k1", kind: "key_result", title: "12 calls booked", status: "on_track", owner: "Maya", dueDate: "2026-10-31" }),
  row({ id: "k2", kind: "key_result", title: "3 clients signed", status: "behind", owner: "Sam", dueDate: "2026-11-15", pathwayStage: "Foundation" }),
  row({ id: "i1", kind: "initiative", title: "Daily DMs", status: "not_started" }),
  row({ id: "i2", kind: "initiative", title: "Webinar", status: "on_track" }),
  row({ id: "k9", kind: "key_result", title: "Loose key result" }),
  row({ id: "old", kind: "goal", title: "Archived", archivedAt: "2026-09-01T00:00:00.000Z" }),
];
const links: LinkRow[] = [
  { fromId: "g1", toKind: "record", toId: "k1" },
  { fromId: "g1", toKind: "record", toId: "k2" },
  { fromId: "k1", toKind: "record", toId: "i1" },
  { fromId: "k1", toKind: "record", toId: "i2" },
  { fromId: "i1", toKind: "task", toId: "t1" },
  { fromId: "i1", toKind: "task", toId: "t2" },
];
const tasks: TaskRef[] = [{ id: "t1", title: "Send 3 DMs", status: "done", dueDate: null }, { id: "t2", title: "Follow up", status: "today", dueDate: null }];

describe("Business goals: the tree", () => {
  it("puts the primary goal first, nests key results and initiatives, counts tasks done, and lists the loose ones; archived rows are out", () => {
    const t = planTree(records, links, tasks);
    expect(t.goals.map((g) => g.record.id)).toEqual(["g1", "g2"]);
    const g1 = t.goals[0];
    expect(g1.keyResults.map((k) => k.record.id)).toEqual(["k1", "k2"]);
    expect(g1.onPace).toBe(1);
    expect(g1.keyResults[0].initiatives.map((i) => [i.record.id, i.done, i.tasks.length])).toEqual([["i1", 1, 2], ["i2", 0, 0]]);
    expect(t.loose.map((r) => r.id)).toEqual(["k9"]);
    expect(coachSummary(t)).toEqual({ goals: 2, keyResults: 2, onPace: 1, initiatives: 2, notStarted: 1 });
  });
  it("reads a record's links both ways", () => {
    expect(linksOf("k1", links)).toEqual({ down: [links[2], links[3]], up: [links[0]] });
  });
  it("the table filters by kind, status, owner, due on or before, and stage, due soonest first", () => {
    // Due soonest first; the rest by their order, then by when they were made.
    expect(tableRows(records, {}).map((r) => r.id)).toEqual(["k1", "k2", "i1", "i2", "k9", "g2", "g1"]);
    expect(tableRows(records, { kind: "key_result", status: "behind" }).map((r) => r.id)).toEqual(["k2"]);
    expect(tableRows(records, { owner: "may" }).map((r) => r.id)).toEqual(["k1"]);
    expect(tableRows(records, { dueBefore: "2026-10-31" }).map((r) => r.id)).toEqual(["k1"]);
    expect(tableRows(records, { stage: "found" }).map((r) => r.id)).toEqual(["k2"]);
  });
  it("a link goes one level down only: goal to key result, key result to initiative, initiative to task", () => {
    expect(CHILD_OF).toEqual({ goal: "key_result", key_result: "initiative", initiative: "task" });
    expect(PARENT_OF).toEqual({ goal: null, key_result: "goal", initiative: "key_result" });
    expect(linkAllowed({ kind: "goal" }, { kind: "key_result" })).toBe(true);
    expect(linkAllowed({ kind: "goal" }, { kind: "initiative" })).toBe(false);
    expect(linkAllowed({ kind: "initiative" }, "task")).toBe(true);
    expect(linkAllowed({ kind: "key_result" }, "task")).toBe(false);
  });
});
