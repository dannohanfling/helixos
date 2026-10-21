/**
 * The Partner Program's data (H-1307, plan H-1361): restaurants, touches, payments and the monthly statement, all scoped to
 * the coach's workspace. The pages, the actions and the MCP tools all come through here. `ownerContact` leaves only through
 * `restaurantById`; lists and tool summaries carry business names and stages.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { buildStatement, CANCEL_REASONS, derive, PAYMENT_PLANS, pick, pickOrNull, RESTAURANT_PLANS, RESTAURANT_SOURCES, RESTAURANT_STAGES, RESTAURANT_TYPES, RISKS, TOUCH_CHANNELS, TOUCH_WHO, WALLETPUSH_STATUSES, type Derived } from "@/lib/engine/partner";
import { PARTNER_PAYMENT_STATUSES } from "@/db/schema";

export type Restaurant = schema.PartnerRestaurant;
export type RestaurantWithDerived = Restaurant & { derived: Derived };

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true" || v === "on" || v === "yes";

/** The editable fields, as a form or a tool sends them; unknown keys are ignored here (the webhook keeps them in `extra`). */
export type RestaurantInput = Partial<Record<string, unknown>>;

/** Read the fields of a restaurant from loose input: lists checked, numbers parsed, everything else trimmed text. */
export function restaurantFields(input: RestaurantInput): Partial<typeof schema.partnerRestaurants.$inferInsert> {
  const f: Partial<typeof schema.partnerRestaurants.$inferInsert> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (has("business")) f.business = String(input.business ?? "").trim();
  if (has("type")) f.type = pick(RESTAURANT_TYPES, input.type, "other");
  if (has("city")) f.city = text(input.city);
  if (has("source")) f.source = pickOrNull(RESTAURANT_SOURCES, input.source);
  if (has("referredBy")) f.referredBy = text(input.referredBy);
  if (has("stage")) f.stage = pick(RESTAURANT_STAGES, input.stage, "talking");
  if (has("plan")) f.plan = pickOrNull(RESTAURANT_PLANS, input.plan);
  if (has("foundingPartner")) f.foundingPartner = bool(input.foundingPartner);
  for (const k of ["firstContactAt", "demoAt", "signedAt", "paidAt", "formCompleteAt", "handedToWalletpushAt", "liveAt", "featuredInGroupAt", "cancelledAt", "setupApprovedAt", "resultsAsOf", "nextStepDate", "termsAcceptedAt"] as const) if (has(k)) f[k] = text(input[k]);
  if (has("walletpushStatus")) f.walletpushStatus = pick(WALLETPUSH_STATUSES, input.walletpushStatus, "not handed");
  if (has("walletpushNote")) f.walletpushNote = text(input.walletpushNote);
  for (const k of ["googleReviewsAtStart", "passHolders", "reviewsGained", "conciergeChats"] as const) if (has(k)) f[k] = num(input[k]) === null ? null : Math.round(num(input[k])!);
  if (has("googleRatingAtStart")) f.googleRatingAtStart = num(input.googleRatingAtStart);
  if (has("risk")) f.risk = pick(RISKS, input.risk, "none");
  if (has("cancelReason")) f.cancelReason = pickOrNull(CANCEL_REASONS, input.cancelReason);
  for (const k of ["nextStep", "notes", "address", "businessPhone", "website", "facebookPage", "instagram", "ownerContact", "brandColors", "hours", "menuLink", "googleBusinessProfile", "reservationLink", "reward", "welcomeReward", "conciergeVoice", "topCustomerQuestions", "restaurantContactForMessages", "directoryCard"] as const) if (has(k)) f[k] = text(input[k]);
  if (has("featureConsent")) f.featureConsent = bool(input.featureConsent);
  return f;
}

export async function restaurantsFor(workspaceId: string, today: string, filter: { stage?: string; city?: string; source?: string } = {}): Promise<RestaurantWithDerived[]> {
  const rows = await db.query.partnerRestaurants.findMany({ where: eq(schema.partnerRestaurants.workspaceId, workspaceId), orderBy: [asc(schema.partnerRestaurants.business)] });
  const stage = filter.stage ? pickOrNull(RESTAURANT_STAGES, filter.stage) : null;
  const city = filter.city?.trim().toLowerCase();
  const source = filter.source ? pickOrNull(RESTAURANT_SOURCES, filter.source) : null;
  return rows
    .filter((r) => (!stage || r.stage === stage) && (!city || (r.city ?? "").toLowerCase() === city) && (!source || r.source === source))
    .map((r) => ({ ...r, derived: derive(r, today) }));
}

export async function restaurantById(workspaceId: string, id: string, today: string): Promise<RestaurantWithDerived | null> {
  const r = await db.query.partnerRestaurants.findFirst({ where: and(eq(schema.partnerRestaurants.workspaceId, workspaceId), eq(schema.partnerRestaurants.id, id)) });
  return r ? { ...r, derived: derive(r, today) } : null;
}

/** A restaurant by its id or its business name (case-insensitive, exact); one match or null. */
export async function restaurantByRef(workspaceId: string, ref: string): Promise<Restaurant | null> {
  const w = ref.trim();
  if (!w) return null;
  const byId = await db.query.partnerRestaurants.findFirst({ where: and(eq(schema.partnerRestaurants.workspaceId, workspaceId), eq(schema.partnerRestaurants.id, w)) });
  if (byId) return byId;
  const rows = await db.query.partnerRestaurants.findMany({ where: eq(schema.partnerRestaurants.workspaceId, workspaceId) });
  const some = rows.filter((r) => r.business.toLowerCase() === w.toLowerCase());
  return some.length === 1 ? some[0] : null;
}

/** Create or update a restaurant: by id when given, else by its business name (one per workspace), else new. */
export async function upsertRestaurant(workspaceId: string, input: RestaurantInput & { id?: string }): Promise<{ id: string; created: boolean }> {
  const f = restaurantFields(input);
  const existing = input.id ? await db.query.partnerRestaurants.findFirst({ where: and(eq(schema.partnerRestaurants.workspaceId, workspaceId), eq(schema.partnerRestaurants.id, String(input.id))) }) : f.business ? await restaurantByRef(workspaceId, f.business) : null;
  if (existing) {
    // Matched by name: the stored spelling stays; only an update by id renames.
    if (!input.id) delete f.business;
    await db.update(schema.partnerRestaurants).set({ ...f, updatedAt: nowIso() }).where(eq(schema.partnerRestaurants.id, existing.id));
    return { id: existing.id, created: false };
  }
  if (!f.business) throw new Error("A restaurant needs its business name.");
  const id = newId();
  await db.insert(schema.partnerRestaurants).values({ id, workspaceId, ...f, business: f.business });
  return { id, created: true };
}

export async function touchesFor(workspaceId: string, restaurantId: string) {
  return db.query.partnerTouches.findMany({ where: and(eq(schema.partnerTouches.workspaceId, workspaceId), eq(schema.partnerTouches.restaurantId, restaurantId)), orderBy: [desc(schema.partnerTouches.date), desc(schema.partnerTouches.createdAt)] });
}

export async function addTouch(workspaceId: string, restaurantId: string, input: RestaurantInput): Promise<string> {
  const id = newId();
  await db.insert(schema.partnerTouches).values({
    id,
    workspaceId,
    restaurantId,
    date: text(input.date) ?? nowIso().slice(0, 10),
    who: pick(TOUCH_WHO, input.who, "Danno"),
    channel: pick(TOUCH_CHANNELS, input.channel, "DM"),
    firstConversation: bool(input.firstConversation),
    note: text(input.note),
    nextStep: text(input.nextStep),
    nextStepDate: text(input.nextStepDate),
  });
  // The restaurant's own next step follows the latest touch that names one.
  const next = text(input.nextStep);
  if (next) await db.update(schema.partnerRestaurants).set({ nextStep: next, nextStepDate: text(input.nextStepDate), updatedAt: nowIso() }).where(eq(schema.partnerRestaurants.id, restaurantId));
  return id;
}

export async function paymentsFor(workspaceId: string, restaurantId?: string) {
  return db.query.partnerPayments.findMany({ where: restaurantId ? and(eq(schema.partnerPayments.workspaceId, workspaceId), eq(schema.partnerPayments.restaurantId, restaurantId)) : eq(schema.partnerPayments.workspaceId, workspaceId), orderBy: [desc(schema.partnerPayments.date)] });
}

/** A payment; the same external id (a processor's or a webhook's) never lands twice. */
export async function addPayment(workspaceId: string, restaurantId: string, input: RestaurantInput): Promise<{ id: string; created: boolean }> {
  const externalId = text(input.externalId);
  if (externalId) {
    const dup = await db.query.partnerPayments.findFirst({ where: and(eq(schema.partnerPayments.workspaceId, workspaceId), eq(schema.partnerPayments.externalId, externalId)) });
    if (dup) return { id: dup.id, created: false };
  }
  const amount = num(input.amount);
  if (amount === null || amount < 0) throw new Error("A payment needs an amount.");
  const date = text(input.date) ?? nowIso().slice(0, 10);
  const id = newId();
  await db.insert(schema.partnerPayments).values({
    id,
    workspaceId,
    restaurantId,
    date,
    plan: pick(PAYMENT_PLANS, input.plan, "monthly"),
    amount,
    tax: num(input.tax) ?? 0,
    feesDeducted: num(input.feesDeducted) ?? 0,
    promo: bool(input.promo),
    status: pick(PARTNER_PAYMENT_STATUSES, input.status, "paid"),
    processor: text(input.processor),
    month: text(input.month) ?? date.slice(0, 7),
    externalId,
    note: text(input.note),
  });
  return { id, created: true };
}

export async function payoutLinesFor(workspaceId: string, month?: string) {
  return db.query.partnerPayoutLines.findMany({ where: month ? and(eq(schema.partnerPayoutLines.workspaceId, workspaceId), eq(schema.partnerPayoutLines.month, month)) : eq(schema.partnerPayoutLines.workspaceId, workspaceId), orderBy: [desc(schema.partnerPayoutLines.month), asc(schema.partnerPayoutLines.restaurantId)] });
}

/**
 * Build (or rebuild) a month's statement: the lines the rules give, with Danno's approved lines kept and the month's other
 * built lines replaced. Adjustments are never touched. Returns what the month now holds.
 */
export async function buildPayouts(workspaceId: string, month: string, opts: { feesOffFirst: boolean }): Promise<{ built: number; kept: number; dropped: number }> {
  const [payments, restaurants, existing] = await Promise.all([
    db.query.partnerPayments.findMany({ where: eq(schema.partnerPayments.workspaceId, workspaceId) }),
    db.query.partnerRestaurants.findMany({ where: eq(schema.partnerRestaurants.workspaceId, workspaceId), columns: { id: true, setupApprovedAt: true } }),
    db.query.partnerPayoutLines.findMany({ where: and(eq(schema.partnerPayoutLines.workspaceId, workspaceId), eq(schema.partnerPayoutLines.month, month)) }),
  ]);
  const r = buildStatement(month, payments, restaurants, existing, opts);
  const dropIds = existing.filter((e) => e.kind !== "adjustment" && !e.approvedByDannoAt).map((e) => e.id);
  if (dropIds.length) await db.delete(schema.partnerPayoutLines).where(inArray(schema.partnerPayoutLines.id, dropIds));
  for (const l of r.lines) await db.insert(schema.partnerPayoutLines).values({ id: newId(), workspaceId, ...l });
  return { built: r.lines.length, kept: r.keep.length, dropped: dropIds.length };
}

/** Danno approves a month's statement: every unapproved line of the month is stamped. Nothing is paid from here. */
export async function approvePayouts(workspaceId: string, month: string): Promise<number> {
  const rows = await db.query.partnerPayoutLines.findMany({ where: and(eq(schema.partnerPayoutLines.workspaceId, workspaceId), eq(schema.partnerPayoutLines.month, month)) });
  const open = rows.filter((r) => !r.approvedByDannoAt).map((r) => r.id);
  if (open.length) await db.update(schema.partnerPayoutLines).set({ approvedByDannoAt: nowIso() }).where(inArray(schema.partnerPayoutLines.id, open));
  return open.length;
}

/** A hand-written adjustment line (a refund already paid out, say): its own kind, left alone by the build. */
export async function addAdjustment(workspaceId: string, restaurantId: string, month: string, amount: number, note: string): Promise<string> {
  const id = newId();
  await db.insert(schema.partnerPayoutLines).values({ id, workspaceId, restaurantId, month, kind: "adjustment", amount, note: note || null, paymentId: null, installment: null });
  return id;
}
