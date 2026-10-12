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
  "In any chat, start with \"Board:\" and what you're deciding (or \"Set up my board\"). Download it again whenever your coach updates the Danno Seat.",
];
