/**
 * The monthly intention (handoff rev 129): the first-of-the-month version of the 3-1-3, the eleven questions from Danno's September
 * post in the Intentions channel, in his order. Pure: dates are the member's own "YYYY-MM-DD", months "YYYY-MM".
 */
import { WORD_MAX } from "./intentions";

export const PERSONAL_SEASONS = ["self", "wealth", "relationships", "spirituality"] as const;
export type PersonalSeason = (typeof PERSONAL_SEASONS)[number];
export const BUSINESS_SEASONS = ["marketing", "sales", "fulfillment", "operations"] as const;
export type BusinessSeason = (typeof BUSINESS_SEASONS)[number];
export const seasonLabel = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The eleven questions, in Danno's order, keyed by the field that holds each answer. The revenue goal is a number plus the why. */
export const MONTH_QUESTIONS = [
  { key: "word", q: "What is one word (or a short phrase) of intention that will guide your actions and mindset this month?" },
  { key: "personalSeason", q: "What personal season are you in?" },
  { key: "fear", q: "What is one fear or limiting belief you'll commit to overcoming this month?" },
  { key: "habit", q: "What is one positive personal habit you'll commit to starting this month?" },
  { key: "skill", q: "What skill will you develop to grow as a leader and entrepreneur?" },
  { key: "impact", q: "What impact do you want to create in your business, and who will benefit from it most?" },
  { key: "businessSeason", q: "What season is your business in?" },
  { key: "revenue", q: "What revenue goal are you aiming for this month, and why?" },
  { key: "plan", q: "What is your plan to reach it?" },
  { key: "proudLast", q: "What are you most proud of from last month?" },
  { key: "proudEnd", q: "At the end of the month, what do you want to look back on and feel most proud of?" },
] as const;

/** The month an intention belongs to. */
export const monthOf = (today: string): string => today.slice(0, 7);
/** Not set by the 4th: from the 4th on, a member with no intention for the month shows under the coach's quiet list. */
export const lateForMonth = (today: string): boolean => Number(today.slice(8)) >= 4;

/** A revenue goal as typed ("$10,000", "10000", "7,500.50"): a positive number, or null. */
export function parseRevenue(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "").replace(/^(USD|NZD|AUD|CAD|GBP|EUR)/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}
/** "$10,000", "$7,500.50". */
export const revenueLabel = (n: number): string => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export type MonthIntentionInput = {
  word: string;
  personalSeason: PersonalSeason;
  fear: string;
  habit: string;
  skill: string;
  impact: string;
  businessSeason: BusinessSeason;
  revenueGoal: number;
  revenueWhy: string;
  plan: string;
  proudLast: string;
  proudEnd: string;
};
/** All eleven are required (rev 129), the revenue goal a number plus the why. The word can be a short phrase, as on the 3-1-3 (rev 160). A refusal names its field. */
export function readMonthIntention(raw: Record<keyof Omit<MonthIntentionInput, "revenueGoal"> | "revenueGoal", string>): { value: MonthIntentionInput } | { error: string; field?: string } {
  const t = (k: keyof typeof raw) => (raw[k] ?? "").trim();
  if (!t("word")) return { error: "Choose one word (or a short phrase) for your month.", field: "word" };
  if (t("word").length > WORD_MAX) return { error: `Keep your word to a short phrase, ${WORD_MAX} characters or fewer.`, field: "word" };
  const personalSeason = PERSONAL_SEASONS.find((s) => s === t("personalSeason"));
  if (!personalSeason) return { error: "Pick your personal season.", field: "personalSeason" };
  if (!t("fear")) return { error: "Name one fear or limiting belief to overcome.", field: "fear" };
  if (!t("habit")) return { error: "Name one habit to start.", field: "habit" };
  if (!t("skill")) return { error: "Name the skill you'll develop.", field: "skill" };
  if (!t("impact")) return { error: "Say what impact you want to create, and who benefits most.", field: "impact" };
  const businessSeason = BUSINESS_SEASONS.find((s) => s === t("businessSeason"));
  if (!businessSeason) return { error: "Pick your business's season.", field: "businessSeason" };
  const revenueGoal = parseRevenue(t("revenueGoal"));
  if (revenueGoal === null) return { error: "Write your revenue goal as a number, like 10000.", field: "revenueGoal" };
  if (!t("revenueWhy")) return { error: "Say why that revenue goal.", field: "revenueWhy" };
  if (!t("plan")) return { error: "Write your plan to reach it.", field: "plan" };
  if (!t("proudLast")) return { error: "Say what you're most proud of from last month.", field: "proudLast" };
  if (!t("proudEnd")) return { error: "Say what you want to feel most proud of at the end of the month.", field: "proudEnd" };
  return { value: { word: t("word"), personalSeason, fear: t("fear"), habit: t("habit"), skill: t("skill"), impact: t("impact"), businessSeason, revenueGoal, revenueWhy: t("revenueWhy"), plan: t("plan"), proudLast: t("proudLast"), proudEnd: t("proudEnd") } };
}
