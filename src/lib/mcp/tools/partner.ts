/**
 * The Partner Program on the connector (H-1307, plan H-1361): partner_restaurants_list, partner_restaurant_get,
 * partner_restaurant_upsert, partner_touch_add, partner_payment_add, partner_payouts_build and partner_payouts_list. Scope
 * `partner`: the coach's own connection when they tick it, or an agent token the coach ticked it on (Mercator's). Lists carry
 * business names, stages and dates, never the owner's contact; that comes back only on a get of one restaurant. Approving a
 * statement is Danno's alone, on the page: no tool here approves, pays, sends or writes to Airtable.
 */
import { z } from "zod";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { CANCEL_REASONS, PAYMENT_PLANS, RESTAURANT_PLANS, RESTAURANT_SOURCES, RESTAURANT_STAGES, RESTAURANT_TYPES, RISKS, restaurantLine, statementTotal, TOUCH_CHANNELS, TOUCH_WHO, WALLETPUSH_STATUSES } from "@/lib/engine/partner";
import { addPayment, addTouch, buildPayouts, payoutLinesFor, restaurantById, restaurantByRef, restaurantsFor, touchesFor, upsertRestaurant, type RestaurantWithDerived } from "@/lib/partner";
import { PARTNER_PAYMENT_STATUSES } from "@/db/schema";

const NOT_FOUND = "No restaurant by that id or business name in your Partner Program.";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional();
const month = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM");

/** A restaurant as a list row: the business and where it stands, no contact. */
function row(r: RestaurantWithDerived) {
  return {
    id: r.id,
    business: r.business,
    type: r.type,
    city: r.city,
    source: r.source,
    stage: r.stage,
    plan: r.plan,
    foundingPartner: r.foundingPartner,
    risk: r.risk,
    walletpushStatus: r.walletpushStatus,
    setupPromise: r.derived.setupPromise,
    setupDue: r.derived.setupDue,
    checkinDue: r.derived.checkinDue,
    checkinOverdue: r.derived.checkinOverdue,
    nextStep: r.nextStep,
    nextStepDate: r.nextStepDate,
    liveAt: r.liveAt,
    updatedAt: r.updatedAt,
  };
}

defineTool({
  name: "partner_restaurants_list",
  scope: "partner",
  kind: "read",
  description:
    "The restaurants in the Partner Program, by business name: id, type, city, source, stage, plan, risk, WalletPush status, the setup promise (not handed, in window, day 5 flag, late, OVERDUE, kept), the 30-day check-in and the next step. Filter by stage, city or source. Never the owner's contact: get one with partner_restaurant_get for that.",
  input: {
    stage: z.enum(RESTAURANT_STAGES).optional(),
    city: z.string().max(80).optional(),
    source: z.enum(RESTAURANT_SOURCES).optional(),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await restaurantsFor(v.workspace.id, v.today, { stage: input.stage as string | undefined, city: input.city as string | undefined, source: input.source as string | undefined });
    if (!rows.length) return { text: "No restaurants match.", data: { restaurants: [] } };
    return {
      text: rows.map((r) => `${restaurantLine(r)}; setup ${r.derived.setupPromise}${r.derived.checkinOverdue ? "; 30-day check-in overdue" : ""}${r.risk !== "none" ? `; risk: ${r.risk}` : ""}`).join("\n"),
      data: { restaurants: rows.map(row) },
    };
  },
});

defineTool({
  name: "partner_restaurant_get",
  scope: "partner",
  kind: "read",
  description: "One restaurant in full, by id or exact business name: every field including the owner's contact and the onboarding answers, plus its touches, newest first. The contact is for the work in hand; it never goes on the Forum, in a post or in a log.",
  input: { restaurant: z.string().min(1).max(120).describe("The id or the business name") },
  handler: async (v, input): Promise<ToolResult> => {
    const ref = await restaurantByRef(v.workspace.id, String(input.restaurant));
    const r = ref ? await restaurantById(v.workspace.id, ref.id, v.today) : null;
    if (!r) return { text: NOT_FOUND, data: null };
    const touches = await touchesFor(v.workspace.id, r.id);
    return {
      text: `${restaurantLine(r)}; setup ${r.derived.setupPromise}${r.derived.setupDue ? ` (due ${r.derived.setupDue})` : ""}; ${touches.length} touch${touches.length === 1 ? "" : "es"}.`,
      data: { restaurant: r, touches },
    };
  },
});

defineTool({
  name: "partner_restaurant_upsert",
  scope: "partner",
  kind: "write",
  description:
    "Add a restaurant or update one: by id when given, else by its business name (one per program). Send only the fields that change. Lists are checked (type, source, stage, plan, walletpushStatus, risk, cancelReason); dates are YYYY-MM-DD. Nothing here approves a setup or a payout.",
  input: {
    id: z.string().max(40).optional(),
    business: z.string().max(120).optional(),
    type: z.enum(RESTAURANT_TYPES).optional(),
    city: z.string().max(80).optional(),
    source: z.enum(RESTAURANT_SOURCES).optional(),
    referredBy: z.string().max(120).optional(),
    stage: z.enum(RESTAURANT_STAGES).optional(),
    plan: z.enum(RESTAURANT_PLANS).optional(),
    foundingPartner: z.boolean().optional(),
    firstContactAt: date, demoAt: date, signedAt: date, paidAt: date, formCompleteAt: date, handedToWalletpushAt: date, liveAt: date, featuredInGroupAt: date, cancelledAt: date, resultsAsOf: date, nextStepDate: date,
    walletpushStatus: z.enum(WALLETPUSH_STATUSES).optional(),
    walletpushNote: z.string().max(500).optional(),
    googleReviewsAtStart: z.number().int().min(0).optional(),
    googleRatingAtStart: z.number().min(0).max(5).optional(),
    passHolders: z.number().int().min(0).optional(),
    reviewsGained: z.number().int().min(0).optional(),
    conciergeChats: z.number().int().min(0).optional(),
    risk: z.enum(RISKS).optional(),
    cancelReason: z.enum(CANCEL_REASONS).optional(),
    nextStep: z.string().max(300).optional(),
    notes: z.string().max(4000).optional(),
    address: z.string().max(300).optional(),
    businessPhone: z.string().max(40).optional(),
    website: z.string().max(300).optional(),
    facebookPage: z.string().max(300).optional(),
    instagram: z.string().max(120).optional(),
    ownerContact: z.string().max(300).optional(),
    brandColors: z.string().max(120).optional(),
    hours: z.string().max(500).optional(),
    menuLink: z.string().max(300).optional(),
    googleBusinessProfile: z.string().max(300).optional(),
    reservationLink: z.string().max(300).optional(),
    reward: z.string().max(300).optional(),
    welcomeReward: z.string().max(300).optional(),
    conciergeVoice: z.string().max(1000).optional(),
    topCustomerQuestions: z.string().max(2000).optional(),
    restaurantContactForMessages: z.string().max(300).optional(),
    featureConsent: z.boolean().optional(),
    directoryCard: z.string().max(1000).optional(),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : undefined;
    if (id && !(await restaurantById(v.workspace.id, id, v.today))) return { text: NOT_FOUND, data: null };
    if (!id && !(typeof input.business === "string" && input.business.trim())) return { text: "A restaurant needs its business name.", data: null };
    const r = await upsertRestaurant(v.workspace.id, { ...input, ...(id ? { id } : {}) });
    const now = (await restaurantById(v.workspace.id, r.id, v.today))!;
    return { text: `${r.created ? "Added" : "Updated"} ${restaurantLine(now)}.`, data: { id: r.id, created: r.created, restaurant: row(now) } };
  },
});

defineTool({
  name: "partner_touch_add",
  scope: "partner",
  kind: "write",
  description: "Log a touch with a restaurant (a DM, a comment, a call, a demo): date (today when left out), who, channel, whether it was the first conversation, a note, and the next step with its date, which becomes the restaurant's next step.",
  input: {
    restaurant: z.string().min(1).max(120).describe("The id or the business name"),
    date,
    who: z.enum(TOUCH_WHO).optional(),
    channel: z.enum(TOUCH_CHANNELS).optional(),
    firstConversation: z.boolean().optional(),
    note: z.string().max(2000).optional(),
    nextStep: z.string().max(300).optional(),
    nextStepDate: date,
  },
  handler: async (v, input): Promise<ToolResult> => {
    const r = await restaurantByRef(v.workspace.id, String(input.restaurant));
    if (!r) return { text: NOT_FOUND, data: null };
    const id = await addTouch(v.workspace.id, r.id, input);
    return { text: `Touch logged for ${r.business}${input.nextStep ? `; next step: ${String(input.nextStep)}` : ""}.`, data: { id, restaurantId: r.id } };
  },
});

defineTool({
  name: "partner_payment_add",
  scope: "partner",
  kind: "write",
  description:
    "Record a payment a restaurant made: date, plan (monthly, annual, setup fee), amount, tax, feesDeducted, promo (earns no payout), status (paid, refunded, chargeback, failed), processor, month (YYYY-MM, the payment's month when left out) and an externalId that keeps the same payment from landing twice. Recording is not paying: nothing moves money.",
  input: {
    restaurant: z.string().min(1).max(120).describe("The id or the business name"),
    date,
    plan: z.enum(PAYMENT_PLANS).optional(),
    amount: z.number().min(0),
    tax: z.number().min(0).optional(),
    feesDeducted: z.number().min(0).optional(),
    promo: z.boolean().optional(),
    status: z.enum(PARTNER_PAYMENT_STATUSES).optional(),
    processor: z.string().max(60).optional(),
    month: month.optional(),
    externalId: z.string().max(120).optional(),
    note: z.string().max(500).optional(),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const r = await restaurantByRef(v.workspace.id, String(input.restaurant));
    if (!r) return { text: NOT_FOUND, data: null };
    const p = await addPayment(v.workspace.id, r.id, input);
    return { text: p.created ? `Payment of ${Number(input.amount).toFixed(2)} recorded for ${r.business}.` : `That payment was already on file for ${r.business} (same external id).`, data: { id: p.id, created: p.created, restaurantId: r.id } };
  },
});

defineTool({
  name: "partner_payouts_build",
  scope: "partner",
  kind: "write",
  description:
    "Build (or rebuild) the month's statement from the payments on file, for Danno's approval on Coach → Partner Program: the share of each monthly payment collected in the month, each setup fee of a restaurant whose setup Danno approved that month, and an annual plan as 12 monthly installments. Refunded, charged-back, failed and promo payments earn nothing. Lines Danno already approved stay; adjustments are untouched. feesOffFirst takes processor fees off before the share.",
  input: { month, feesOffFirst: z.boolean().optional() },
  handler: async (v, input): Promise<ToolResult> => {
    const m = String(input.month);
    const r = await buildPayouts(v.workspace.id, m, { feesOffFirst: Boolean(input.feesOffFirst) });
    const lines = await payoutLinesFor(v.workspace.id, m);
    return { text: `${m}: ${r.built} line${r.built === 1 ? "" : "s"} built, ${r.kept} approved kept, total ${statementTotal(lines).toFixed(2)}. Danno approves on the page.`, data: { month: m, ...r, total: statementTotal(lines) } };
  },
});

defineTool({
  name: "partner_payouts_list",
  scope: "partner",
  kind: "read",
  description: "The statement's lines for a month (or every month when left out): restaurant, kind (monthly, setup, yearly_installment, adjustment), amount, installment number, note and whether Danno approved it, with the total.",
  input: { month: month.optional() },
  handler: async (v, input): Promise<ToolResult> => {
    const m = typeof input.month === "string" ? input.month : undefined;
    const lines = await payoutLinesFor(v.workspace.id, m);
    const names = new Map((await restaurantsFor(v.workspace.id, v.today)).map((r) => [r.id, r.business]));
    const out = lines.map((l) => ({ id: l.id, month: l.month, restaurant: names.get(l.restaurantId) ?? l.restaurantId, restaurantId: l.restaurantId, kind: l.kind, amount: l.amount, installment: l.installment, note: l.note, approvedByDannoAt: l.approvedByDannoAt }));
    if (!out.length) return { text: m ? `No lines for ${m}.` : "No statement lines yet.", data: { lines: [], total: 0 } };
    return { text: `${out.length} line${out.length === 1 ? "" : "s"}${m ? ` for ${m}` : ""}, total ${statementTotal(out).toFixed(2)}, ${out.filter((l) => l.approvedByDannoAt).length} approved.`, data: { lines: out, total: statementTotal(out) } };
  },
});
