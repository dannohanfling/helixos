/**
 * End-of-month feedback (handoff rev 124), from the Airtable "Feedback Form": five to ten minutes on the month just ending. Pure:
 * dates are the member's own "YYYY-MM-DD", months "YYYY-MM".
 */
import { addDays } from "@/lib/dates";

/** The last day of a month, as its day number. */
export const lastDayOf = (month: string): number => Number(addDays(`${nextMonth(month)}-01`, -1).slice(8));
export const nextMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
export const prevMonth = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * The month feedback is asked for today, or null outside the window: the last 3 days of a month ask about that month, and the 1st
 * to the 5th ask about the month before. The member never picks it.
 */
export function feedbackMonth(today: string): string | null {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8));
  if (day >= lastDayOf(month) - 2) return month;
  if (day <= 5) return prevMonth(month);
  return null;
}
/** The first day the window opens for a month: three days before its end. */
export const windowOpens = (month: string): string => `${month}-${String(lastDayOf(month) - 2).padStart(2, "0")}`;

export type FeedbackInput = { proud: string; love: string; less: string; more: string; wow: string; referralScore: number; referral: string; favorite: string };
/** Required: proud, Love, Less, More, Wow and a whole-number referral score from 1 to 10. Optional: who they'd refer, and their favorite part. */
export function readFeedback(raw: Record<keyof FeedbackInput, string>): { value: FeedbackInput } | { error: string } {
  const t = (k: keyof FeedbackInput) => (raw[k] ?? "").trim();
  if (!t("proud")) return { error: "Tell us what you're most proud of this past month." };
  for (const [k, label] of [["love", "Love"], ["less", "Less"], ["more", "More"], ["wow", "Wow"]] as const) if (!t(k)) return { error: `Fill in ${label}.` };
  const score = Number(t("referralScore"));
  if (!/^\d+$/.test(t("referralScore")) || score < 1 || score > 10) return { error: "Pick a referral score from 1 to 10." };
  return { value: { proud: t("proud"), love: t("love"), less: t("less"), more: t("more"), wow: t("wow"), referralScore: score, referral: t("referral"), favorite: t("favorite") } };
}

/** One month's responses for the coach: how many, and the average referral score to one decimal (null with none). */
export function monthSummary(scores: number[]): { count: number; average: number | null } {
  if (!scores.length) return { count: 0, average: null };
  return { count: scores.length, average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 };
}
/** The trend against the month before, in plain words: "up 0.8", "down 1.2", "no change", or "" with nothing to compare. */
export function trendLine(now: number | null, before: number | null): string {
  if (now === null || before === null) return "";
  const d = Math.round((now - before) * 10) / 10;
  return d > 0 ? `up ${d.toFixed(1)}` : d < 0 ? `down ${Math.abs(d).toFixed(1)}` : "no change";
}
/** "September 2026". */
export const monthLabel = (month: string): string => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
