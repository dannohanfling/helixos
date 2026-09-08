import { describe, expect, it } from "vitest";
import libraryJson from "@/data/seed/task_library.json";

const library = libraryJson as { key: string; stage: string; order: number; name: string; priority: string }[];

describe("the platform choice is infrastructure", () => {
  it("lives first in system-install, not in stage 1", () => {
    const platform = library.find((t) => t.name === "Choose where your community will live")!;
    expect(platform.stage).toBe("system-install");
    expect(platform.order).toBe(1);
    const onboardingMust = library.filter((t) => t.stage === "onboarding" && t.priority === "must").map((t) => t.name);
    expect(onboardingMust).not.toContain("Choose where your community will live");
  });
});
