/**
 * Applause on Colosseum wins (H-1171, plan H-1177): the pure rules. Points go through the ledger with a key each, so nothing
 * scores twice; a take-back is a minus row, never a deleted one, so the ledger stays a true record and any points sync sees it.
 *
 * - The applauder: +2 a win, at most 10 a day. A coach earns nothing for applauding.
 * - The winner: +5 an applause, or +10 from the coach, at most 25 a win.
 * - Sharing a win: +10, once a day.
 */
export const APPLAUD_POINTS = 2;
export const APPLAUDER_DAY_CAP = 10;
export const RECEIVED_POINTS = 5;
export const COACH_APPLAUSE_POINTS = 10;
export const WIN_CAP = 25;
export const SHARE_POINTS = 10;

/** What the applauder earns for this applause, given what applauding has earned them today. */
export function applauderPoints(role: "coach" | "client", todaySoFar: number): number {
  if (role !== "client") return 0;
  return Math.max(0, Math.min(APPLAUD_POINTS, APPLAUDER_DAY_CAP - Math.max(0, todaySoFar)));
}

/** What the winner earns for this applause, given what applause on this win has earned them so far. */
export function winnerPoints(byCoach: boolean, receivedSoFar: number): number {
  return Math.max(0, Math.min(byCoach ? COACH_APPLAUSE_POINTS : RECEIVED_POINTS, WIN_CAP - Math.max(0, receivedSoFar)));
}

/** The ledger keys: one per (applauder, win) and per (winner, win, applauder); a take-back has its own key. */
export const keys = {
  applauded: (winId: string) => `applaud:${winId}`,
  unapplauded: (winId: string) => `unapplaud:${winId}`,
  received: (winId: string, by: string) => `applauded:${winId}:${by}`,
  unreceived: (winId: string, by: string) => `unapplauded:${winId}:${by}`,
  receivedPrefix: (winId: string) => `applauded:${winId}:`,
  shared: (day: string) => `win-share:${day}`,
  unshared: (day: string) => `win-unshare:${day}`,
  takenDown: (winId: string) => `win-down:${winId}`,
};

/** The reasons the member reads in their points. */
export const reasons = {
  applauded: "Applauded a win",
  unapplauded: "Applause taken back",
  received: "Your win was applauded",
  receivedFromCoach: (coachFirst: string) => `${coachFirst} applauded your win`,
  unreceived: "Applause on your win taken back",
  shared: "Shared a win",
  unshared: "A win shared today came down",
  takenDown: "Applause on a win you took down",
};

/** A short form of the win's words for the Today line: the first 60 characters, cut at a word. */
export function shortWin(text: string, max = 60): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** Today's line: "3 people applauded your win: …", or "Danno applauded your win: …" when the coach is the only one. */
export function applauseLine(a: { count: number; coachOnly: string | null; text: string }): string {
  const who = a.coachOnly ? a.coachOnly : a.count === 1 ? "1 person" : `${a.count} people`;
  return `${who} applauded your win: ${shortWin(a.text)}`;
}
