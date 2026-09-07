import { describe, expect, it } from "vitest";
import { ADMIN_ONBOARDING_KEYS, simplePath } from "../pathway";
import stagesJson from "@/data/seed/stages.json";
import libraryJson from "@/data/seed/task_library.json";

type Lib = Parameters<typeof simplePath>[1][number];
const stages = (stagesJson as { key: string; order: number }[]).map((s) => ({ key: s.key, order: s.order }));
const library = (libraryJson as { key: string; stage: string; order: number; name: string; priority: string }[]).map((t) => ({ ...t, stageKey: t.stage })) as unknown as Lib[];

describe("stage 1 after the platform task moved to system-install", () => {
  it("puts the platform choice first in system-install", () => {
    const platform = library.find((t) => t.name === "Choose where your community will live")!;
    expect(platform.stageKey).toBe("system-install");
    expect(platform.order).toBe(1);
  });
  it("still has five must-do tasks that are neither positioning nor the demoted admin set, so it is not task-less today", () => {
    const remaining = library.filter((t) => t.stageKey === "onboarding" && t.priority === "must" && !ADMIN_ONBOARDING_KEYS.has(t.key)).map((t) => t.name);
    expect(remaining).toEqual(["Create a safe test contact process", "Request missing access and implementation assets", "Build internal offer brief", "Map the customer journey from entry to purchase", "Build registration confirmation workflow"]);
    const path = simplePath(stages, library, []);
    expect(path.stageKey).toBe("onboarding");
    expect(path.now[0]?.name).toBe("Create a safe test contact process");
  });
});
