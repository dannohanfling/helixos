import { describe, expect, it } from "vitest";
import { roadLine } from "../pathway";
import stages from "@/data/seed/stages.json";

const S = (stages as { key: string; order: number; name: string; expectedDuration: string | null }[]).map((s) => ({ key: s.key, order: s.order, name: s.name, expectedDuration: s.expectedDuration }));

describe("the road", () => {
  it("names the stage, its week and the destination ahead, from the stages' own durations", () => {
    expect(roadLine(S, "onboarding")).toBe("Stage 1 of 7 · Week 1 · first conversion event around Week 6");
    expect(roadLine(S, "community")).toBe("Stage 3 of 7 · Weeks 2–5 · first conversion event around Week 6");
    expect(roadLine(S, "launch-first-conversion-event")).toBe("Stage 4 of 7 · Week 6 · this is the first conversion event");
    expect(roadLine(S, "scale")).toBe("Stage 6 of 7 · Months 2–6 · first conversion event behind you");
    expect(roadLine(S, "onboarding", true)).toBe("Every stage done.");
  });
  it("still says where you are when no destination stage exists", () => {
    expect(roadLine([{ key: "a", order: 1, name: "A", expectedDuration: "Week 1" }], "a")).toBe("Stage 1 of 1 · Week 1");
  });
});
