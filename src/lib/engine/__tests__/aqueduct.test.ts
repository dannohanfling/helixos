import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BODY, boardQuestion, CHANNEL, CHANNEL_LENGTH, dashPeriod, DROP_PERIOD, FALL_STREAKS, fallSheet, FILL_SECONDS, FLOW, flowWidth, frontReaches, pathLength, RUN_PERIOD, FALLS, leakOf, loopFor, missingLine, pictureFor, SEGMENTS, slipped, STAGE_TAG_AT, STAGES, STEP_LABELS, STEP_TAG_AT, STEP_TOOLS, stepRate, waterWidth, windows } from "@/lib/engine/aqueduct";

describe("the Aqueduct (rev 711)", () => {
  it("eight stages, six steps, each step with a label and a tool; the geometry as the brief lists it", () => {
    expect(STAGES).toHaveLength(8);
    expect(STEP_LABELS).toHaveLength(6);
    expect(STEP_TOOLS.map((t) => t.href)).toEqual(["/content/ladders", "/conversations", "/conversations/playbook", "/socrates", "/socrates/scripts", "/offers"]);
    expect(SEGMENTS.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(FALLS.day).toHaveLength(6);
    expect(FALLS.night[5]).toEqual([1185, 381, 730, 1193, 745, 42, 13]);
    expect(STAGE_TAG_AT).toHaveLength(8);
    expect(STEP_TAG_AT[5]).toEqual([1300, 455]);
  });
  it("the windows: the last N days ending today, and the N before them", () => {
    expect(windows("2026-10-14", 7)).toEqual({ now: ["2026-10-08", "2026-10-14"], before: ["2026-10-01", "2026-10-07"] });
    expect(windows("2026-10-14", 30)).toEqual({ now: ["2026-09-15", "2026-10-14"], before: ["2026-08-16", "2026-09-14"] });
  });
  it("a step's rate is stage b+2 over stage b+1; a missing count or a zero denominator is no rate", () => {
    const c = [10, 40, 20, 10, 5, 4, 2, 1];
    expect(stepRate(c, 0)).toBe(0.5);
    expect(stepRate(c, 5)).toBe(0.5);
    expect(stepRate([10, 0, 5, 1, 1, 1, 1, 1], 0)).toBeNull();
    expect(stepRate([10, null, 5, 1, 1, 1, 1, 1], 0)).toBeNull();
    expect(stepRate([10, 5, null, 1, 1, 1, 1, 1], 0)).toBeNull();
    expect(stepRate([10, 5, null, 1, 1, 1, 1, 1], 1)).toBeNull();
    expect(stepRate([10, 5, 2, 1, 1, 1, 1, 1], 2)).toBe(1);
  });
  it("the leak is the biggest drop in points, at least five, skipping steps a period can't rate", () => {
    const before = [10, 100, 50, 25, 10, 8, 4, 2]; // rates .5 .5 .4 .8 .5 .5
    const now = [10, 100, 50, 10, 4, 3, 2, 1]; // rates .5 .2 .4 .75 .67 .5
    const leak = leakOf(now, before)!;
    expect(leak.step).toBe(1);
    expect(Math.round(leak.drop)).toBe(30);
    expect(leakOf([10, 100, 50, 24, 10, 8, 4, 2], before)).toBeNull(); // 48% from 50%: under five points
    expect(leakOf([10, 100, 45, 23, 10, 8, 4, 2], before)?.step).toBe(0); // 45% from 50%: exactly five points
    expect(leakOf([10, 100, 0, 0, 0, 0, 0, 0], before)?.step).toBe(0); // 0 of 100 is a 50-point drop at step 0; every later step has a zero denominator and is skipped
    expect(leakOf([10, 0, 0, 0, 0, 0, 0, 0], before)).toBeNull(); // nothing can be rated
  });
  it("the picture follows the leak and the look; the words count the people who slipped", () => {
    const before = [10, 100, 50, 25, 10, 8, 4, 2];
    const now = [10, 100, 50, 10, 4, 3, 2, 1];
    const leak = leakOf(now, before)!;
    expect(pictureFor("day", leak)).toBe("/aqueduct/aqueduct-day-1");
    expect(pictureFor("night", null)).toBe("/aqueduct/aqueduct-night-none");
    expect(slipped(now, leak)).toEqual({ n: 15, expected: 25 });
    expect(slipped([10, 100, 50, 24, 10, 8, 4, 2], { step: 1, nowRate: 0.48, wasRate: 0.5, drop: 2 })).toEqual({ n: 1, expected: 25 });
    expect(boardQuestion(leak)).toBe("My dms started → conversations rate fell from 50% to 20%. What should I change first?");
  });
  it("the water's width grows with the count against comments; missing counts are said in one line", () => {
    expect(waterWidth(100, 100)).toBe(14);
    expect(waterWidth(25, 100)).toBe(8.5);
    expect(waterWidth(0, 100)).toBe(3);
    expect(waterWidth(10, null)).toBe(3);
    expect(missingLine([1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
    expect(missingLine([1, null, 3, 4, 5, 6, 7, null])).toBe("No count yet for Comments, Clients: the steps either side are left out until there is one.");
  });
});

describe("the water (H-966)", () => {
  it("runs three flow layers over the body: ripple bands, streaks in two lanes, a sparse sparkle", () => {
    expect(FLOW.map((l) => l.key)).toEqual(["band", "streak-a", "streak-b", "spark"]);
    expect(new Set(FLOW.map((l) => l.seconds)).size).toBe(FLOW.length);
    expect(FLOW.find((l) => l.key === "band")!.seconds).toBe(Math.max(...FLOW.map((l) => l.seconds)));
    expect(BODY.core).toBeLessThan(1);
  });

  it("loops every pattern without a jump: each period divides the shared run, which the stylesheet uses", () => {
    for (const l of FLOW) expect(RUN_PERIOD % dashPeriod(l.array)).toBeCloseTo(0, 6);
    for (const s of FALL_STREAKS) expect(DROP_PERIOD % dashPeriod(s.array)).toBe(0);
    const css = readFileSync("src/components/aqueduct.css", "utf8");
    expect(css).toContain(`@keyframes aq-run { to { stroke-dashoffset: -${RUN_PERIOD}; } }`);
    expect(css).toContain(`@keyframes aq-drop { to { stroke-dashoffset: -${DROP_PERIOD}; } }`);
    // The fountain's streaks run aq-drop too.
    expect(DROP_PERIOD % dashPeriod(readFileSync("src/components/aqueduct-repair.css", "utf8").match(/\.aq-wf \{[^}]*stroke-dasharray: ([\d ]+);/)![1])).toBe(0);
  });

  it("keeps the thinnest water showing every layer", () => {
    for (const l of FLOW) expect(flowWidth(l, 3)).toBeGreaterThanOrEqual(l.min);
    expect(flowWidth(FLOW[1], 3)).toBe(FLOW[1].min);
    expect(flowWidth(FLOW[0], 14)).toBeCloseTo(14 * FLOW[0].width, 5);
  });

  it("joins the segments into one channel for the front, from the source to the fountain", () => {
    expect(CHANNEL.startsWith("M185,266")).toBe(true);
    expect(CHANNEL.endsWith("1528,598")).toBe(true);
    expect(CHANNEL.match(/M/g)).toHaveLength(1);
    expect(CHANNEL_LENGTH).toBeCloseTo(SEGMENTS.reduce((sum, s) => sum + pathLength(s.d), 0), 0);
    expect(pathLength("M0,0 L3,4")).toBe(5);
  });

  it("lets what waits for the water arrive with the front", () => {
    expect(frontReaches(185)).toBe(0);
    expect(frontReaches(1528)).toBe(FILL_SECONDS);
    expect(frontReaches(735)).toBeGreaterThan(0);
    expect(frontReaches(735)).toBeLessThan(frontReaches(1165));
  });

  it("draws a fall as a sheet that widens as it falls, with five streaks of their own widths and speeds", () => {
    const d = fallSheet(735, 505, 750);
    expect(d.startsWith("M731,505 L739,505")).toBe(true);
    expect(d).toContain("748,750 L722,750");
    expect(FALL_STREAKS).toHaveLength(5);
    expect(new Set(FALL_STREAKS.map((s) => s.seconds)).size).toBe(5);
    expect(new Set(FALL_STREAKS.map((s) => s.w)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("the filmed loops (H-1180)", () => {
  it("lists Golden hour with no leak, with versioned files, and nothing else yet", () => {
    const day = loopFor(pictureFor("day", null));
    expect(day).toEqual({ mp4: "/aqueduct/aqueduct-day-none-loop.mp4?v=1", webm: "/aqueduct/aqueduct-day-none-loop.webm?v=1", poster: "/aqueduct/aqueduct-day-none-loop-poster.jpg?v=1" });
    expect(loopFor(pictureFor("night", null))).toBeNull();
    expect(loopFor(pictureFor("day", { step: 2, nowRate: 0.1, wasRate: 0.4, drop: 0.3 }))).toBeNull();
  });
  it("every listed loop has its three files in public/", () => {
    for (const p of ["/aqueduct/aqueduct-day-none"]) for (const end of ["-loop.mp4", "-loop.webm", "-loop-poster.jpg"]) expect(readFileSync(`public${p}${end}`).length).toBeGreaterThan(1000);
  });
});
