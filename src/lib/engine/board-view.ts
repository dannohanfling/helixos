/**
 * My Board, the few pure pieces the Boardroom's client component needs (rev 698): the modes, where the seats sit, how long each
 * speaks, and how a step's time reads. Kept apart from engine/board so the page's browser bundle never carries the skill, the
 * profile, the source pack or the checks.
 */
/** Where each seat sits around the table (rev 698), centre point as % of the room, in speaking order: the chair first. */
export const SEAT_SPOTS: { left: number; top: number }[] = [
  { left: 50, top: 11 },
  { left: 11, top: 38 },
  { left: 89, top: 38 },
  { left: 86, top: 80 },
  { left: 14, top: 80 },
];

/** How long each advisor holds the room (rev 698, as in the mockup). */
export const SPEAK_MS = 3400;

export const MODES = ["board", "focus", "debate", "quick_vote", "workaround", "leverage", "converge", "checkin"] as const;
export type Mode = (typeof MODES)[number];
/** The chips (rev 664 §2), in the skill's Help Mode words. */
export const MODE_INFO: Record<Mode, { label: string; line: string; prefix: string }> = {
  board: { label: "Board", line: "All five advisors look at a decision.", prefix: "Board:" },
  focus: { label: "Focus", line: "Hear from one advisor only.", prefix: "Focus:" },
  debate: { label: "Debate", line: "The two or three advisors who disagree most argue it out.", prefix: "Debate:" },
  quick_vote: { label: "Quick Vote", line: "See how each advisor leans on clear options.", prefix: "Quick Vote:" },
  workaround: { label: "Workaround", line: "Find ways around a real constraint.", prefix: "Workaround:" },
  leverage: { label: "Leverage", line: "Find the smallest move with the biggest upside.", prefix: "Leverage:" },
  converge: { label: "Converge", line: "Turn the discussion into one decision brief.", prefix: "Converge" },
  checkin: { label: "Check-in", line: "Review last time's action steps: done, stuck or dropped.", prefix: "Check-in:" },
};

export function takesWords(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The six install steps beside the download (Claude's own words for its settings). */
export const SKILL_INSTALL_STEPS = [
  "Download your Board (the button above). It's one file, evolve-omega-board.skill.",
  "Open Claude (claude.ai or the Claude app) and go to Settings, then Capabilities.",
  "Make sure code execution and file creation is on: skills need it.",
  "Under Skills, choose Upload skill and pick evolve-omega-board.skill.",
  "Switch the Evolve Omega Board skill on.",
  "In any chat, start with \"Board:\" and what you're deciding (or \"Set up my board\"). Download it again whenever your coach updates Danno.",
];

/* ───────────────────────── The Council Chamber (rev 738) ───────────────────────── */

/**
 * The five chairs, % of the 1680×944 photo (the same in both looks), in the seats' own order: head of the table, left, right,
 * front right, front left. A preset's seats take the chairs in order (the Edge Preset's five sit where the standard five do).
 * l/t/w/h is the statue's box; px/py the name plate's centre.
 */
export const CHAIRS: { l: number; t: number; w: number; h: number; px: number; py: number }[] = [
  { l: 45.54, t: 11.65, w: 9.52, h: 21.19, px: 50.3, py: 7.63 },
  { l: 25.0, t: 22.78, w: 13.1, h: 37.08, px: 27.98, py: 20.13 },
  { l: 62.2, t: 24.15, w: 14.7, h: 36.76, px: 70.83, py: 21.19 },
  { l: 57.14, t: 53.5, w: 23.81, h: 42.9, px: 87.2, py: 81.57 },
  { l: 19.64, t: 52.97, w: 22.32, h: 42.9, px: 12.8, py: 81.57 },
];
/** Where the table's text sits on the dark tabletop, % of the room. */
export const TABLE_BOX = { l: 41.07, t: 42.37, w: 18.45, h: 30.72 };

export type SceneLook = "day" | "night";
/** The look a member sees: their own choice once made; "auto" is night from 19:00 to 06:00 in their own time. */
export function sceneLookFor(setting: "auto" | "day" | "night", hour: number): SceneLook {
  if (setting === "day" || setting === "night") return setting;
  return hour >= 19 || hour < 6 ? "night" : "day";
}

/**
 * Speaking clips (rev 738, optional): public/board/council-{look}-{seat}.mp4 and .webm, listed here once they're in the repo, so a
 * turn never asks for a clip that isn't there. Empty until Danno adds them.
 */
export const COUNCIL_CLIPS: string[] = [];
