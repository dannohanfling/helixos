/**
 * The Partner Program (H-1307, plan H-1361), the pure parts: the fixed lists (plain text in the database, checked here, so a
 * new value is a one-line change), the dates derived from a restaurant's record, and the month's statement to the
 * fulfillment partner under Danno's settled terms (H-1356). No database, no request.
 */
import { addDays, daysBetween } from "@/lib/dates";

export const RESTAURANT_TYPES = ["restaurant", "cafe", "bakery", "food truck", "bar", "caterer", "other"] as const;
export const RESTAURANT_SOURCES = ["in the group", "nominated", "referred by partner", "outreach", "WalletPush network", "pilot"] as const;
export const RESTAURANT_STAGES = ["talking", "demo booked", "demo done", "signed", "onboarding", "handed to WalletPush", "live", "at risk", "cancelled", "declined"] as const;
export const RESTAURANT_PLANS = ["monthly", "annual", "pilot"] as const;
export const WALLETPUSH_STATUSES = ["not handed", "received", "in setup", "live", "blocked"] as const;
export const RISKS = ["none", "no results yet", "owner quiet", "payment failed", "asked to cancel"] as const;
export const CANCEL_REASONS = ["price", "no results", "closed", "switched tool", "other"] as const;
export const TOUCH_WHO = ["Danno", "Mercator", "mod", "bot", "WalletPush"] as const;
export const TOUCH_CHANNELS = ["DM", "comment", "bot", "call", "demo", "email", "in person", "post"] as const;
export const PAYMENT_PLANS = ["monthly", "annual", "setup fee"] as const;

/** Keep a value from a fixed list, or the fallback: a webhook or a tool may send anything. */
export function pick<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  const v = String(value ?? "").trim().toLowerCase();
  return (list.find((x) => x.toLowerCase() === v) as T[number] | undefined) ?? fallback;
}
export function pickOrNull<T extends readonly string[]>(list: T, value: unknown): T[number] | null {
  const v = String(value ?? "").trim().toLowerCase();
  return v ? ((list.find((x) => x.toLowerCase() === v) as T[number] | undefined) ?? null) : null;
}

/** The setup promise: WalletPush has seven days from the hand-off; a flag at day five; kept once live. */
export const SETUP_DAYS = 7;
export const SETUP_FLAG_DAY = 5;
export const CHECKIN_DAYS = 30;
export type SetupPromise = "not handed" | "in window" | "day 5 flag" | "late" | "OVERDUE" | "kept";

export type RestaurantDates = { handedToWalletpushAt: string | null; liveAt: string | null; resultsAsOf: string | null };
export type Derived = { setupDue: string | null; setupDays: number | null; setupPromise: SetupPromise; checkinDue: string | null; checkinOverdue: boolean };

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** What the record implies today: the setup clock from the hand-off, the 30-day check-in from going live. */
export function derive(r: RestaurantDates, today: string): Derived {
  const handed = day(r.handedToWalletpushAt);
  const live = day(r.liveAt);
  const setupDue = handed ? addDays(handed, SETUP_DAYS) : null;
  const setupDays = handed ? daysBetween(handed, live ?? today) : null;
  let setupPromise: SetupPromise = "not handed";
  if (handed && live) setupPromise = daysBetween(handed, live) <= SETUP_DAYS ? "kept" : "late";
  else if (handed) setupPromise = daysBetween(handed, today) > SETUP_DAYS ? "OVERDUE" : daysBetween(handed, today) >= SETUP_FLAG_DAY ? "day 5 flag" : "in window";
  const checkinDue = live ? addDays(live, CHECKIN_DAYS) : null;
  const checkinOverdue = Boolean(checkinDue && checkinDue <= today && !r.resultsAsOf);
  return { setupDue, setupDays, setupPromise, checkinDue, checkinOverdue };
}

// ── The monthly statement (H-1356) ──────────────────────────────────────────────────────────────────────────────────────
export type PaymentIn = { id: string; restaurantId: string; plan: string; amount: number; tax: number; feesDeducted: number; promo: boolean; status: string; month: string };
export type RestaurantIn = { id: string; setupApprovedAt: string | null };
export type LineIn = { restaurantId: string; month: string; kind: string; paymentId: string | null; installment: number | null; approvedByDannoAt: string | null };
export type LineOut = { restaurantId: string; month: string; kind: "monthly" | "setup" | "yearly_installment"; amount: number; paymentId: string; installment: number | null; note: string };

export const SHARE = 0.5;
export const YEARLY_INSTALLMENTS = 12;

const round2 = (n: number) => Math.round(n * 100) / 100;
/** The share base: the amount collected, sales tax off, card fees off only when Danno's switch says so. */
export function shareOf(p: Pick<PaymentIn, "amount" | "tax" | "feesDeducted">, feesOffFirst: boolean): number {
  return round2(SHARE * Math.max(0, p.amount - p.tax - (feesOffFirst ? p.feesDeducted : 0)));
}
/** YYYY-MM plus n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * The lines a month's statement should carry, from the paid, non-promo payments: 50% of each monthly payment collected that
 * month; the setup fee's 50% in the month the restaurant's setup was approved; a yearly payment as 12 equal installments
 * starting the month collected. Refunded, charged-back, failed and promo payments earn nothing. Lines Danno already
 * approved are kept as they are and never rebuilt; adjustments are their own lines, written by hand, left alone here.
 */
export function buildStatement(month: string, payments: PaymentIn[], restaurants: RestaurantIn[], existing: LineIn[], opts: { feesOffFirst: boolean }): { lines: LineOut[]; keep: LineIn[]; drop: LineIn[] } {
  const approvedBy = new Map(restaurants.map((r) => [r.id, r.setupApprovedAt ? r.setupApprovedAt.slice(0, 7) : null]));
  const paid = payments.filter((p) => p.status === "paid" && !p.promo);
  const lines: LineOut[] = [];
  for (const p of paid) {
    const share = shareOf(p, opts.feesOffFirst);
    if (!share) continue;
    if (p.plan === "monthly" && p.month === month) lines.push({ restaurantId: p.restaurantId, month, kind: "monthly", amount: share, paymentId: p.id, installment: null, note: `50% of the monthly payment collected ${p.month}` });
    if (p.plan === "setup fee" && approvedBy.get(p.restaurantId) === month) lines.push({ restaurantId: p.restaurantId, month, kind: "setup", amount: share, paymentId: p.id, installment: null, note: `50% of the setup fee, setup approved ${month}` });
    if (p.plan === "annual") {
      // Installment k (1 to 12) falls in the month collected plus k minus 1.
      for (let k = 1; k <= YEARLY_INSTALLMENTS; k++) {
        if (addMonths(p.month, k - 1) !== month) continue;
        const each = round2(share / YEARLY_INSTALLMENTS);
        const amount = k === YEARLY_INSTALLMENTS ? round2(share - each * (YEARLY_INSTALLMENTS - 1)) : each;
        lines.push({ restaurantId: p.restaurantId, month, kind: "yearly_installment", amount, paymentId: p.id, installment: k, note: `Yearly plan collected ${p.month}: installment ${k} of ${YEARLY_INSTALLMENTS}` });
      }
    }
  }
  const mine = existing.filter((e) => e.month === month && e.kind !== "adjustment");
  const keep = mine.filter((e) => e.approvedByDannoAt);
  const drop = mine.filter((e) => !e.approvedByDannoAt);
  const kept = new Set(keep.map((e) => `${e.kind}:${e.paymentId}:${e.installment ?? ""}`));
  return { lines: lines.filter((l) => !kept.has(`${l.kind}:${l.paymentId}:${l.installment ?? ""}`)), keep, drop };
}

/** A statement's total: every line of the month, adjustments included. */
export function statementTotal(lines: { amount: number }[]): number {
  return round2(lines.reduce((t, l) => t + l.amount, 0));
}

/** A restaurant's one-line summary for lists and tool output: the business and its stage, never the owner's contact. */
export function restaurantLine(r: { business: string; stage: string; city: string | null; plan: string | null }): string {
  return [r.business, r.stage, r.city, r.plan].filter(Boolean).join(" · ");
}
