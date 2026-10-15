/**
 * The Setup card (H-270 §1, the Client Roadmap's Part 1): the 26 setup steps as data, seeded from src/data/seed/setup.json and
 * the coach's to edit, each with the group it sits in, the link it opens, the signal that says it's done and the steps it needs
 * first. Pure: which steps are done from the member's facts, which are open next (needs met, in order), the "N of 20 done"
 * count over the first three groups, and when the card retires. Nothing here reads the database.
 */
import setupJson from "@/data/seed/setup.json";

export type SetupGroupKey = "day-one" | "foundation" | "tools" | "when-needed";
export const SETUP_GROUPS: { key: SetupGroupKey; name: string }[] = [
  { key: "day-one", name: "Day one: your account" },
  { key: "foundation", name: "Week one: your foundation" },
  { key: "tools", name: "Week one: your tools" },
  { key: "when-needed", name: "When you need them" },
];
export const groupName = (key: string): string => SETUP_GROUPS.find((g) => g.key === key)?.name ?? key;
/** The groups the card counts and waits for ("the first 20"); the Pathway opens once they are done. */
export const CORE_GROUPS: SetupGroupKey[] = ["day-one", "foundation", "tools"];

export type SetupStepDef = { key: string; group: string; order: number; label: string; href: string; signal: string; needs: string[]; minutes: number };
export const SETUP_STEPS: SetupStepDef[] = (setupJson as SetupStepDef[]).slice().sort(byPlace);

export function byPlace(a: { group: string; order: number }, b: { group: string; order: number }): number {
  const ga = CORE_GROUPS.indexOf(a.group as SetupGroupKey);
  const gb = CORE_GROUPS.indexOf(b.group as SetupGroupKey);
  return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb) || a.order - b.order;
}

/** What HelixOS knows about one member, read once (src/lib/setup.ts), as the signals read it. */
export type SetupFacts = {
  signedIn: boolean;
  startHereWatched: boolean;
  profileSaved: boolean;
  photo: boolean;
  firstLockin: boolean;
  bigPromise: boolean;
  goal: boolean;
  essence: boolean;
  logo: boolean;
  brandKit: boolean;
  aiKey: boolean;
  council: boolean;
  ghl: { connected: boolean; pages: boolean; mapped: boolean };
  bookingLink: boolean;
  bot: { connected: boolean; facts: boolean };
  team: boolean;
  claude: boolean;
  fathom: boolean;
  mfDomains: boolean;
  assistant: boolean;
  humanos: boolean;
  /** The steps ticked by hand: the member's own, or the coach's for them. */
  ticks: string[];
  /** The steps the coach ticked (a "coach-tick" step counts only these). */
  coachTicks: string[];
};

/** Every signal a step can read, in the coach's words. */
export const SETUP_SIGNALS: { key: string; words: string }[] = [
  { key: "tick", words: "a tick by the member, or by you for them" },
  { key: "coach-tick", words: "your tick, as their coach (shown to them as your status)" },
  { key: "signed-in", words: "their first sign-in" },
  { key: "start-here", words: "the Start Here video played to the end" },
  { key: "profile-saved", words: "Settings → You saved (time zone and reminder hours)" },
  { key: "photo", words: "their photo saved" },
  { key: "first-lockin", words: "their first lock-in" },
  { key: "big-promise", words: "the Big Promise and who it's for, both saved" },
  { key: "goal", words: "their one goal saved" },
  { key: "essence", words: "Essence's mission, goals and stories filled" },
  { key: "logo", words: "a logo in Images" },
  { key: "brand-kit", words: "a brand kit saved that passes the contrast check" },
  { key: "ai-key", words: "an AI drafting key whose test call passed" },
  { key: "council", words: "their council chosen (five chairs)" },
  { key: "ghl-connected", words: "GoHighLevel connected, test call passed" },
  { key: "ghl-pages", words: "pages found on the GoHighLevel connection" },
  { key: "ghl-mapped", words: "channels mapped on Settings → GoHighLevel" },
  { key: "booking-link", words: "a booking link saved in Your bot" },
  { key: "bot-connected", words: "their bot connected, test call passed" },
  { key: "bot-facts", words: "what the bot says saved, with an approved line" },
  { key: "team", words: "a team member who accepted an invite" },
  { key: "claude", words: "Claude connected" },
  { key: "fathom", words: "a Fathom key saved" },
  { key: "mf-domains", words: "a Magic funnel domain saved" },
  { key: "assistant", words: "the coach's assistant switch on" },
  { key: "humanos", words: "HumanOS turned on" },
];
export const setupSignalWords = (key: string): string => SETUP_SIGNALS.find((s) => s.key === key)?.words ?? SETUP_SIGNALS[0].words;

/** Whether one step is done from the facts: its signal, or its tick when the signal is a tick (or unknown). */
export function stepDone(step: { key: string; signal: string }, f: SetupFacts): boolean {
  const ticked = f.ticks.includes(step.key);
  switch (step.signal) {
    case "coach-tick":
      return f.coachTicks.includes(step.key);
    case "signed-in":
      return f.signedIn;
    case "start-here":
      return f.startHereWatched || ticked;
    case "profile-saved":
      return f.profileSaved;
    case "photo":
      return f.photo;
    case "first-lockin":
      return f.firstLockin;
    case "big-promise":
      return f.bigPromise;
    case "goal":
      return f.goal;
    case "essence":
      return f.essence;
    case "logo":
      return f.logo;
    case "brand-kit":
      return f.brandKit;
    case "ai-key":
      return f.aiKey;
    case "council":
      return f.council;
    case "ghl-connected":
      return f.ghl.connected;
    case "ghl-pages":
      return f.ghl.pages;
    case "ghl-mapped":
      return f.ghl.mapped;
    case "booking-link":
      return f.bookingLink;
    case "bot-connected":
      return f.bot.connected;
    case "bot-facts":
      return f.bot.facts;
    case "team":
      return f.team;
    case "claude":
      return f.claude;
    case "fathom":
      return f.fathom;
    case "mf-domains":
      return f.mfDomains;
    case "assistant":
      return f.assistant;
    case "humanos":
      return f.humanos;
    default:
      return ticked;
  }
}

export type SetupStep = SetupStepDef & { done: boolean; ready: boolean; needsFirst: SetupStepDef[] };

/** Every step with its done state, whether its needs are met (ready), and the steps still in its way. */
export function setupSteps(defs: SetupStepDef[], f: SetupFacts): SetupStep[] {
  const done = new Map(defs.map((d) => [d.key, stepDone(d, f)]));
  return defs
    .slice()
    .sort(byPlace)
    .map((d) => {
      const needsFirst = d.needs.map((k) => defs.find((x) => x.key === k)).filter((x): x is SetupStepDef => Boolean(x) && !done.get(x!.key));
      return { ...d, done: done.get(d.key) ?? false, ready: needsFirst.length === 0, needsFirst };
    });
}

export const isCore = (step: { group: string }): boolean => CORE_GROUPS.includes(step.group as SetupGroupKey);

/** "N of 20 done": the core groups' steps. */
export function setupStats(steps: SetupStep[]): { done: number; total: number } {
  const core = steps.filter(isCore);
  return { done: core.filter((s) => s.done).length, total: core.length };
}

/** The card retires once every core step is done. */
export const setupComplete = (steps: SetupStep[]): boolean => steps.filter(isCore).every((s) => s.done);

/** The next open steps for the card: not done, needs met, in order, at most `n`; the core groups first, then the rest. */
export function nextSetupSteps(steps: SetupStep[], n = 3): SetupStep[] {
  return steps.filter((s) => !s.done && s.ready).slice(0, n);
}

/** Minutes as the card says them: "about 1 hr 15 min", "2 min", nothing for a coach's step. */
export function minutesWords(m: number): string {
  if (!m) return "";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `about ${h} hr ${r} min` : `about ${h} hr`;
}

/** A video link HelixOS can play itself (mp4, webm, mov, m4v): the ended event marks the step. Anything else opens in a new tab and the member ticks it. */
export const playableVideo = (url: string | null | undefined): boolean => Boolean(url && /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url.trim()));
