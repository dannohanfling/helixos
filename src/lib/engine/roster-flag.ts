/**
 * The coach's client list says who needs them (H-164 §17): one flag per client, the most pressing first. A question waiting
 * beats a quiet week, which beats a bot not yet connected; nothing pressing, no flag.
 */
export type RosterFlag = "question" | "no_lockin" | "bot";

export const FLAG_WORDS: Record<RosterFlag, string> = {
  question: "A question waiting",
  no_lockin: "No lock-in in 7 days",
  bot: "Bot not connected",
};

export const FLAG_RANK: Record<RosterFlag, number> = { question: 0, no_lockin: 1, bot: 2 };

/** Days a member has before a missing lock-in counts against them: a first week is for finding their feet. */
export const QUIET_DAYS = 7;

export function rosterFlag(o: { questionsWaiting: number; daysSinceLockIn: number | null; daysSinceJoined: number; botConnected: boolean }): RosterFlag | null {
  if (o.questionsWaiting > 0) return "question";
  const quiet = o.daysSinceLockIn === null ? o.daysSinceJoined >= QUIET_DAYS : o.daysSinceLockIn >= QUIET_DAYS;
  if (quiet) return "no_lockin";
  if (!o.botConnected) return "bot";
  return null;
}

/** Flagged clients first (the most pressing flag first), then the rest as they were. */
export function byNeed<T extends { flag: RosterFlag | null }>(a: T, b: T): number {
  return (a.flag ? FLAG_RANK[a.flag] : 9) - (b.flag ? FLAG_RANK[b.flag] : 9);
}
