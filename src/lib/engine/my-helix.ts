import rungsJson from "@/data/seed/rungs.json";

/**
 * My Helix (rev 707 with rev 710's curriculum): a turning double helix of the member's progress through the program, one rung
 * a step, ten phases bottom to top. Pure: the geometry, the phase colours, the "done" rules, the next rung and the stats, and
 * the signal each rung reads. The rule from the brief: a rung reads a completion signal HelixOS already has, or it is a tick
 * by the member (or the coach for them); nothing is inferred.
 */

/** Rev 710's geometry for 67 rungs. */
export const STEP_PX = 14;
export const TWIST_DEG = 30;
export const RADIUS_PX = 120;
export const BALL_PX = 13;
export const BACKBONE_PX = 7;
export const BAR_PX = 5;
export const STAGE_PX = 1020;
export const PERSPECTIVE_PX = 1000;
export const TURN_SECONDS = 30;
export const GLOW_PX = 12;
export const GREY_BAR = "#34373F";
export const GREY_BALL = ["#8A8F99", "#2A2D35"] as const;
export const FADE_OPACITY = 0.35;
/** The helix scales to this and the phase list stacks under it below this width. */
export const NARROW_SCALE = 0.68;
export const NARROW_PX = 860;

export type Phase = { n: number; name: string; main: string; dark: string };
/** Ten phases, bottom to top, each with its main colour and a dark one for shading (rev 710 §1). */
export const PHASES: Phase[] = [
  { n: 0, name: "Essence", main: "#E9E4D8", dark: "#8F8878" },
  { n: 1, name: "Create the offer", main: "#F25F5C", dark: "#9E2B28" },
  { n: 2, name: "Optimise the offer", main: "#F28C38", dark: "#9C5216" },
  { n: 3, name: "Leverage social media", main: "#F5C542", dark: "#9E7A12" },
  { n: 4, name: "Get more leads", main: "#8BD14E", dark: "#4A8420" },
  { n: 5, name: "Nurture leads", main: "#2EC48A", dark: "#127550" },
  { n: 6, name: "Convert leads", main: "#2FB8D6", dark: "#136E84" },
  { n: 7, name: "Automate acquisition", main: "#4F7CF5", dark: "#2240A0" },
  { n: 8, name: "Automate content", main: "#8B5CF6", dark: "#4F2AA8" },
  { n: 9, name: "Run a conversion event", main: "#E25CC4", dark: "#8C2A78" },
];
export const phaseOf = (n: number): Phase => PHASES[Math.max(0, Math.min(PHASES.length - 1, n))];

export type RungDef = { key: string; phase: number; order: number; label: string; signal: string; href: string };
/** The 67 rungs as seeded (src/data/seed/rungs.json); the live list is the helix_rungs table, which the coach may edit. */
export const RUNGS: RungDef[] = (rungsJson as RungDef[]).slice().sort(byPlace);
export function byPlace(a: { phase: number; order: number }, b: { phase: number; order: number }): number {
  return a.phase - b.phase || a.order - b.order;
}

/** Where rung i (0 = the lowest) sits: its height from the bottom and its turn. */
export function rungPlace(i: number): { y: number; theta: number } {
  return { y: i * STEP_PX, theta: i * TWIST_DEG };
}
/** The backbone ball between rung i and i + 1 sits halfway, on both strands. */
export function backbonePlace(i: number): { y: number; theta: number } {
  return { y: (i + 0.5) * STEP_PX, theta: (i + 0.5) * TWIST_DEG };
}
/** A backbone ball is coloured only when the rungs on both sides are done. */
export const backboneLit = (done: boolean[], i: number): boolean => Boolean(done[i] && done[i + 1]);

/** The first incomplete rung in order, or null when the helix is complete. */
export function nextRung<T extends { done: boolean }>(rungs: T[]): T | null {
  return rungs.find((r) => !r.done) ?? null;
}
export function stats(rungs: { done: boolean }[]): { built: number; total: number; pct: number } {
  const built = rungs.filter((r) => r.done).length;
  return { built, total: rungs.length, pct: rungs.length ? Math.round((100 * built) / rungs.length) : 0 };
}

/** What HelixOS knows about one member, gathered once; every signal reads from here. */
export type HelixFacts = {
  essence: string[];
  avatars: number;
  offers: { promise: boolean; framework: boolean; containerPrice: boolean; objections: boolean; tiers: string[] };
  pathwayMax: number;
  ladders: { launched: number; shipped: number };
  postStreak: number;
  magnets: number;
  magnetsPublished: number;
  log: { newLeads: number; dmsStarted: number; callsBooked: number; callsHeld: number; offersMade: number };
  content: { count: number; scheduled: number; posted: number };
  scripts: number;
  clients: number;
  botLive: boolean;
  webinar: { any: boolean; named: boolean; registration: boolean; delivered: boolean; offers: boolean; debrief: boolean; sale: boolean };
  ticks: string[];
};
export const EMPTY_FACTS: HelixFacts = {
  essence: [],
  avatars: 0,
  offers: { promise: false, framework: false, containerPrice: false, objections: false, tiers: [] },
  pathwayMax: 0,
  ladders: { launched: 0, shipped: 0 },
  postStreak: 0,
  magnets: 0,
  magnetsPublished: 0,
  log: { newLeads: 0, dmsStarted: 0, callsBooked: 0, callsHeld: 0, offersMade: 0 },
  content: { count: 0, scheduled: 0, posted: 0 },
  scripts: 0,
  clients: 0,
  botLive: false,
  webinar: { any: false, named: false, registration: false, delivered: false, offers: false, debrief: false, sale: false },
  ticks: [],
};

/** The signals a rung can read, with the words the page and the coach's editor show for each. */
export const SIGNALS: { key: string; words: string }[] = [
  { key: "tick", words: "a tick by you, or by your coach for you" },
  { key: "essence:mission", words: "your Essence's mission and goals sections filled" },
  { key: "essence:stories", words: "your Essence's stories section filled" },
  { key: "avatar", words: "an avatar with who they are and their pains" },
  { key: "offer:promise", words: "an offer with its promise" },
  { key: "offer:framework", words: "an offer with its mechanism or path steps" },
  { key: "offer:container-price", words: "an offer with a container and a price" },
  { key: "offer:objections", words: "an offer with its objections answered" },
  { key: "offer:tier:freebie", words: "an offer on the Freebie tier" },
  { key: "offer:tier:starter", words: "an offer on the Starter tier" },
  { key: "offer:tier:core", words: "an offer on the Core tier" },
  { key: "offer:tier:premium", words: "an offer on the Premium tier" },
  { key: "pathway:2", words: "a pathway with two or more offers on it" },
  { key: "ladder:launched", words: "a ladder launched" },
  { key: "ladder:shipped", words: "a ladder shipped to the workflow" },
  { key: "posts:streak:7", words: "a post logged seven days in a row" },
  { key: "magnet:any", words: "a lead magnet started" },
  { key: "magnet:published", words: "a lead magnet published" },
  { key: "log:newLeads:1", words: "your daily log's new leads reach 1" },
  { key: "log:newLeads:10", words: "your daily log's new leads reach 10" },
  { key: "log:newLeads:50", words: "your daily log's new leads reach 50" },
  { key: "content:15", words: "15 content items, any status" },
  { key: "content:scheduled", words: "a content item scheduled ahead" },
  { key: "content:posted", words: "a content item posted, with its link" },
  { key: "log:dmsStarted:1", words: "a first DM started in your daily log" },
  { key: "script:any", words: "a Socrates script saved" },
  { key: "log:callsBooked:1", words: "a first call booked in your daily log" },
  { key: "log:callsHeld:1", words: "a first call held in your daily log" },
  { key: "log:offersMade:1", words: "a first offer made in your daily log" },
  { key: "client:any", words: "a client record" },
  { key: "bot:live", words: "your Bot connection live" },
  { key: "webinar:any", words: "a webinar started" },
  { key: "webinar:named", words: "a webinar with its title and promise" },
  { key: "webinar:registration", words: "a webinar's Magic funnel live, or its registration link set" },
  { key: "webinar:delivered", words: "a webinar held, with a show count" },
  { key: "webinar:offers", words: "offers made on a webinar" },
  { key: "webinar:debrief", words: "a webinar's debrief filled" },
  { key: "webinar:sale", words: "a sale on a webinar" },
];
export const signalWords = (key: string): string => SIGNALS.find((s) => s.key === key)?.words ?? "a tick by you, or by your coach for you";
export const isTick = (signal: string): boolean => !SIGNALS.some((s) => s.key === signal && s.key !== "tick");

/** Whether one rung is done from the facts: its signal, or its tick when the signal is a tick (or unknown). */
export function rungDone(rung: { key: string; signal: string }, f: HelixFacts): boolean {
  const s = rung.signal;
  const ticked = f.ticks.includes(rung.key);
  const [a, b, c] = s.split(":");
  switch (a) {
    case "essence":
      return b === "mission" ? f.essence.includes("mission_and_vision") && f.essence.includes("goals_and_objectives") : f.essence.includes("stories");
    case "avatar":
      return f.avatars > 0;
    case "offer":
      if (b === "tier") return f.offers.tiers.includes(c);
      return b === "promise" ? f.offers.promise : b === "framework" ? f.offers.framework : b === "container-price" ? f.offers.containerPrice : b === "objections" ? f.offers.objections : ticked;
    case "pathway":
      return f.pathwayMax >= Number(b);
    case "ladder":
      return (b === "shipped" ? f.ladders.shipped : f.ladders.launched) > 0;
    case "posts":
      return f.postStreak >= Number(c);
    case "magnet":
      return (b === "published" ? f.magnetsPublished : f.magnets) > 0;
    case "log":
      return (f.log[b as keyof HelixFacts["log"]] ?? 0) >= Number(c);
    case "content":
      return b === "scheduled" ? f.content.scheduled > 0 : b === "posted" ? f.content.posted > 0 : f.content.count >= Number(b);
    case "script":
      return f.scripts > 0;
    case "client":
      return f.clients > 0;
    case "bot":
      return f.botLive;
    case "webinar":
      return Boolean(f.webinar[b as keyof HelixFacts["webinar"]]);
    default:
      return ticked;
  }
}

/** The longest run of consecutive days (YYYY-MM-DD) in the set. */
export function longestRun(days: Iterable<string>): number {
  const set = new Set(days);
  let best = 0;
  for (const d of set) {
    const prev = new Date(`${d}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    if (set.has(prev.toISOString().slice(0, 10))) continue;
    let n = 1;
    const cur = new Date(`${d}T00:00:00Z`);
    for (;;) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      if (!set.has(cur.toISOString().slice(0, 10))) break;
      n += 1;
    }
    best = Math.max(best, n);
  }
  return best;
}

export type HelixRung = RungDef & { done: boolean; ticked: boolean; tick: boolean; words: string };
/** Every rung with its state, in order, bottom to top. */
export function helixRungs(defs: RungDef[], f: HelixFacts): HelixRung[] {
  return defs
    .slice()
    .sort(byPlace)
    .map((r) => ({ ...r, done: rungDone(r, f), ticked: f.ticks.includes(r.key), tick: isTick(r.signal), words: signalWords(r.signal) }));
}
