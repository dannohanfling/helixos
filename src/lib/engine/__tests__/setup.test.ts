import { describe, expect, it } from "vitest";
import { byPlace, CORE_GROUPS, isCore, minutesWords, nextSetupSteps, playableVideo, SETUP_SIGNALS, SETUP_STEPS, setupComplete, setupStats, setupSteps, stepDone, type SetupFacts } from "@/lib/engine/setup";

const none: SetupFacts = {
  signedIn: true,
  startHereWatched: false,
  profileSaved: false,
  photo: false,
  firstLockin: false,
  bigPromise: false,
  goal: false,
  essence: false,
  logo: false,
  brandKit: false,
  aiKey: false,
  council: false,
  ghl: { connected: false, pages: false, mapped: false },
  bookingLink: false,
  bot: { connected: false, facts: false },
  team: false,
  claude: false,
  fathom: false,
  mfDomains: false,
  assistant: false,
  humanos: false,
  ticks: [],
  coachTicks: [],
};
const all: SetupFacts = { ...none, startHereWatched: true, profileSaved: true, photo: true, firstLockin: true, bigPromise: true, goal: true, essence: true, logo: true, brandKit: true, aiKey: true, council: true, ghl: { connected: true, pages: true, mapped: true }, bookingLink: true, bot: { connected: true, facts: true }, team: true, claude: true, fathom: true, mfDomains: true, assistant: true, humanos: true, coachTicks: ["s12", "s17"] };

describe("The Setup card (H-270 §1)", () => {
  it("seeds the 26 steps of the Roadmap's Part 1, S1 and S1a first, every signal known, every need a real step", () => {
    expect(SETUP_STEPS).toHaveLength(26);
    expect(SETUP_STEPS.slice(0, 3).map((s) => s.key)).toEqual(["s1", "s1a", "s2"]);
    const keys = new Set(SETUP_STEPS.map((s) => s.key));
    for (const s of SETUP_STEPS) {
      expect(SETUP_SIGNALS.some((x) => x.key === s.signal), `${s.key} reads ${s.signal}`).toBe(true);
      for (const n of s.needs) expect(keys.has(n), `${s.key} needs ${n}`).toBe(true);
    }
    expect(SETUP_STEPS.filter(isCore)).toHaveLength(20);
    expect(CORE_GROUPS).toEqual(["day-one", "foundation", "tools"]);
  });
  it("a fresh client, just signed in: 1 of 20 done; the next open steps are S1a, S2 and S3 (S4 waits for S2)", () => {
    const steps = setupSteps(SETUP_STEPS, none);
    expect(setupStats(steps)).toEqual({ done: 1, total: 20 });
    expect(nextSetupSteps(steps).map((s) => s.key)).toEqual(["s1a", "s2", "s3"]);
    expect(steps.find((s) => s.key === "s4")!.ready).toBe(false);
    expect(steps.find((s) => s.key === "s4")!.needsFirst.map((s) => s.key)).toEqual(["s2"]);
    expect(setupComplete(steps)).toBe(false);
  });
  it("the order follows needs first: with the time zone saved, S4 opens; Essence waits for the Big Promise; the bot facts wait for three", () => {
    const steps = setupSteps(SETUP_STEPS, { ...none, profileSaved: true, photo: true, startHereWatched: true });
    expect(nextSetupSteps(steps).map((s) => s.key)).toEqual(["s4", "s5", "s6"]);
    expect(steps.find((s) => s.key === "s7")!.needsFirst.map((s) => s.key)).toEqual(["s5"]);
    expect(steps.find((s) => s.key === "s19")!.needsFirst.map((s) => s.key)).toEqual(["s7", "s16", "s18"]);
  });
  it("a coach's step counts only the coach's tick; a tick step counts either tick; the video counts a tick when it can't be played here", () => {
    expect(stepDone({ key: "s12", signal: "coach-tick" }, { ...none, ticks: ["s12"] })).toBe(false);
    expect(stepDone({ key: "s12", signal: "coach-tick" }, { ...none, coachTicks: ["s12"] })).toBe(true);
    expect(stepDone({ key: "x", signal: "tick" }, { ...none, ticks: ["x"] })).toBe(true);
    expect(stepDone({ key: "x", signal: "no-such-signal" }, { ...none, ticks: ["x"] })).toBe(true);
    expect(stepDone({ key: "s1a", signal: "start-here" }, { ...none, ticks: ["s1a"] })).toBe(true);
  });
  it("every core step done retires the card; the six When you need them steps never hold it", () => {
    const steps = setupSteps(SETUP_STEPS, { ...all, team: false, claude: false, fathom: false, mfDomains: false, humanos: false });
    expect(setupStats(steps)).toEqual({ done: 20, total: 20 });
    expect(setupComplete(steps)).toBe(true);
    expect(nextSetupSteps(steps).map((s) => s.key)).toEqual(["s20", "s21", "s22"]);
  });
  it("sorts by group then order, the When you need them group last", () => {
    expect([{ group: "when-needed", order: 1 }, { group: "tools", order: 2 }, { group: "day-one", order: 9 }].sort(byPlace).map((x) => x.group)).toEqual(["day-one", "tools", "when-needed"]);
  });
  it("says minutes plainly and knows a playable video link", () => {
    expect(minutesWords(0)).toBe("");
    expect(minutesWords(2)).toBe("2 min");
    expect(minutesWords(75)).toBe("about 1 hr 15 min");
    expect(minutesWords(120)).toBe("about 2 hr");
    expect(playableVideo("https://x.test/start-here.mp4")).toBe(true);
    expect(playableVideo("/board/council-night-danno.mp4?v=2")).toBe(true);
    expect(playableVideo("https://fathom.video/share/abc")).toBe(false);
    expect(playableVideo(null)).toBe(false);
  });
});
