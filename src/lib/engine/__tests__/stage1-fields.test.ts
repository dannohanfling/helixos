import { describe, expect, it } from "vitest";
import { FIELD_TASKS, fieldTaskStatus, simplePath } from "../pathway";
import stagesJson from "@/data/seed/stages.json";
import libraryJson from "@/data/seed/task_library.json";

type Lib = Parameters<typeof simplePath>[1][number];
const stages = (stagesJson as { key: string; order: number }[]).map((s) => ({ key: s.key, order: s.order }));
const library = (libraryJson as { key: string; stage: string; order: number; name: string; priority: string }[]).map((t) => ({ ...t, stageKey: t.stage })) as unknown as Lib[];

describe("stage 1 is three field-bound tasks", () => {
  it("offers the Big Promise first to a brand-new client, then audience, then the goal", () => {
    const path = simplePath(stages, library, []);
    expect(path.stageKey).toBe("onboarding");
    expect(path.now.map((t) => t.name)).toEqual(["Write your Big Promise", "Name who it's for", "Set your 90-day revenue goal"]);
    expect(path.pathCount).toBe(3);
  });
  it("completes each task from its field, and the stage from all three", () => {
    expect(fieldTaskStatus({ bigPromise: null, audience: null, goalTarget: 0 })).toEqual({ "field-big-promise": false, "field-audience": false, "field-revenue-goal": false });
    expect(fieldTaskStatus({ bigPromise: "I help coaches fill a group", audience: "  ", goalTarget: 5000 })).toEqual({ "field-big-promise": true, "field-audience": false, "field-revenue-goal": true });
    const allDone = Object.keys(FIELD_TASKS).map((k) => ({ libraryTaskKey: k, status: "verified" as const }));
    const path = simplePath(stages, library, allDone as never);
    expect(path.stageKey).toBe("system-install");
  });
});
