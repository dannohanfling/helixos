/**
 * The reminder emails' words, verbatim from the brief and in Danno's voice; nothing here is rewritten, tightened or padded.
 * The state (a running streak, a streak broken yesterday, a rank within fifty points, or none) picks the subject and the one
 * state line; the state line is one line or nothing. Pure: the caller supplies the numbers.
 */

export type MorningState = { first: string; streak: number; brokenYesterday: boolean; points: number; nextTier: { name: string; minPoints: number } | null };
export type EveningState = { first: string; streak: number; bonus: number };
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

export const FOOTER_TEXT = "Reminders come at 8am and 5pm. Change them in Settings.";

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
    footerText: FOOTER_TEXT,
  };
}

export function eveningCopy(s: EveningState): EmailCopy {
  return {
    subject: s.streak > 0 ? `${s.first} — close out day ${s.streak}` : `${s.first}, close the day`,
    preheader: "Numbers in, one win named. Ninety seconds.",
    greeting: `Evening, ${s.first}.`,
    stateLine: s.streak > 0 ? `Day ${s.streak} of your streak. Close it and it holds.` : null,
    asks: ["Log your numbers.", "Name the win.", "Ninety seconds."],
    buttonLabel: "Close my day",
    pointsLine: s.bonus > 0 ? `+20 points. +${s.bonus} more for the streak.` : "+20 points.",
    path: "/today#close",
    footerText: FOOTER_TEXT,
  };
}

/**
 * The comeback email's existing words, laid into the template's slots without a word changed: the first sentence is the
 * greeting, the rest the asks. Its preheader is its own first line until Danno writes one.
 */
export function comebackCopy(first: string, monday: boolean): EmailCopy {
  return {
    subject: monday ? `${first}, Mondays are restart day` : `${first}, today is restart day`,
    preheader: "The system doesn't punish pauses, it just resets the streak.",
    greeting: "Happens.",
    stateLine: null,
    asks: ["The system doesn't punish pauses, it just resets the streak.", "Day 1 is 10 points. By Friday it's 310."],
    buttonLabel: "Lock in my day",
    pointsLine: "",
    path: "/today",
    footerText: FOOTER_TEXT,
  };
}
