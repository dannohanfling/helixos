/**
 * The reminder emails' words, verbatim from the brief and in Danno's voice; nothing here is rewritten, tightened or padded.
 * The state (a running streak, a streak broken yesterday, a rank within fifty points, or none) picks the subject and the one
 * state line; the state line is one line or nothing. Pure: the caller supplies the numbers.
 */

/** The client's own reminder hours (0–23), which the footer states; never a hard-coded time. */
export type ReminderHours = { morning: number; evening: number };
export type MorningState = { first: string; streak: number; brokenYesterday: boolean; points: number; nextTier: { name: string; minPoints: number } | null; hours: ReminderHours };
/** `streak` is the days already closed; tonight's close makes it one more. */
export type EveningState = { first: string; streak: number; bonus: number; hours: ReminderHours };
export type EmailCopy = { subject: string; preheader: string; greeting: string; stateLine: string | null; asks: string[]; buttonLabel: string; pointsLine: string; path: string; footerText: string };

/** Within this many points of the next rank, the morning email says so. */
export const RANK_WITHIN = 50;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "four", "forty", "forty-two"; digits from a hundred up. The brief writes small counts as words. */
export function numberWords(n: number): string {
  if (n < 0 || n >= 100 || !Number.isInteger(n)) return String(n);
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "8am", "5pm", "12pm". */
export function hourLabel(h: number): string {
  const n = ((h % 24) + 24) % 24;
  return `${n % 12 === 0 ? 12 : n % 12}${n < 12 ? "am" : "pm"}`;
}

/** The footer, with this client's own hours. The sentence shape is the brief's. */
export function footerText(hours: ReminderHours): string {
  return `Reminders come at ${hourLabel(hours.morning)} and ${hourLabel(hours.evening)}. Change them in Settings.`;
}

export function morningCopy(s: MorningState): EmailCopy {
  const toNext = s.nextTier ? s.nextTier.minPoints - s.points : Infinity;
  const closeToRank = s.nextTier !== null && toNext > 0 && toNext <= RANK_WITHIN;
  const [subject, stateLine] =
    s.streak > 0
      ? [`${s.first} — day ${s.streak}`, `${cap(numberWords(s.streak))} ${s.streak === 1 ? "day" : "days"} straight. Don't break it today.`]
      : s.brokenYesterday
        ? [`${s.first}, start again today`, "You missed yesterday. That's fine. Start again."]
        : closeToRank
          ? [`${s.first} — ${toNext} points to ${s.nextTier!.name}`, `${s.points} points. ${cap(numberWords(toNext))} more and you're ${s.nextTier!.name}.`]
          : [`${s.first}, lock in your day`, null];
  return {
    subject,
    preheader: "Three things. Sixty seconds. Then you're free.",
    greeting: `Morning, ${s.first}.`,
    stateLine,
    asks: ["Pick your top three.", "Set your energy.", "That's it. Sixty seconds."],
    buttonLabel: "Lock in my day",
    pointsLine: "+10 points when you do.",
    path: "/today",
    footerText: footerText(s.hours),
  };
}

export function eveningCopy(s: EveningState): EmailCopy {
  // Both numbers, honestly: the days behind them, and what tonight's close makes it.
  return {
    subject: s.streak > 0 ? `${s.first} — make it ${numberWords(s.streak + 1)}` : `${s.first}, close the day`,
    preheader: "Numbers in, one win named. Ninety seconds.",
    greeting: `Evening, ${s.first}.`,
    stateLine: s.streak > 0 ? `${cap(numberWords(s.streak))} ${s.streak === 1 ? "day" : "days"} behind you. Close today and it's ${numberWords(s.streak + 1)}.` : null,
    asks: ["Log your numbers.", "Name the win.", "Ninety seconds."],
    buttonLabel: "Close my day",
    pointsLine: s.bonus > 0 ? `+20 points. +${s.bonus} more for the streak.` : "+20 points.",
    path: "/today#close",
    footerText: footerText(s.hours),
  };
}

/**
 * The comeback email, three quiet days in. The subject and preheader are the brief's: no imagined backlog, nothing to catch
 * up on. The body keeps its existing words, laid into the slots without a word changed: the first sentence is the greeting,
 * the rest the asks.
 */
export function comebackCopy(first: string, hours: ReminderHours): EmailCopy {
  return {
    subject: `${first}, pick it back up`,
    preheader: "No catching up to do. Just today.",
    greeting: "Happens.",
    stateLine: null,
    asks: ["The system doesn't punish pauses, it just resets the streak.", "Day 1 is 10 points. By Friday it's 310."],
    buttonLabel: "Lock in my day",
    pointsLine: "",
    path: "/today",
    footerText: footerText(hours),
  };
}
