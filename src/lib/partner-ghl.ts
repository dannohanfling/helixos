/**
 * The Partner Program's two GoHighLevel webhooks (H-1361 PR B, Scriba's contract H-1398), arriving through /api/webhooks/ghl
 * with the workspace's inbound secret: `gnc.order_paid` (a restaurant signed and paid: the restaurant matched or made, its
 * plan and dates, the owner's contact on the record only, and one Payment per amount) and `gnc.onboarding_submitted` (the
 * onboarding answers onto the restaurant, the form-complete date that starts the setup clock, a bot touch). Both land once:
 * an order by its order id, a submission by its submission id. Keys we don't know go in `extra`, never dropped. The sync log
 * carries the event, the business and the ids, never the owner's contact.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { RESTAURANT_STAGES } from "@/lib/engine/partner";
import { addPayment, addTouch, restaurantByRef, upsertRestaurant, type Restaurant } from "@/lib/partner";

type Body = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const t = s(v);
  const m = t.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  const p = Date.parse(t);
  return Number.isFinite(p) ? new Date(p).toISOString().slice(0, 10) : null;
};
/** GHL sends a checkbox group as one comma-separated string; a list stays a list. */
export const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : s(v) ? s(v).split(",").map((x) => x.trim()).filter(Boolean) : []);
const stageIndex = (stage: string) => RESTAURANT_STAGES.indexOf(stage as (typeof RESTAURANT_STAGES)[number]);

/** The keys of the contract the restaurant row has its own column for; everything else in the body goes to `extra`. */
const KNOWN = new Set(["event", "sent_at", "contact_id", "order_id", "transaction_id", "paid_at", "plan", "plan_tag", "amount_total", "amount_setup", "amount_recurring", "currency", "tax", "processor_fee", "business_name", "owner_first_name", "owner_last_name", "owner_email", "owner_phone", "source_page", "submission_id", "owner_name", "address", "website", "facebook_url", "instagram_url", "google_business_url", "hours", "logo_url", "menu_url", "photo_urls", "brand_colors", "reward_visits", "reward_text", "welcome_offer", "slow_nights", "staff_language", "concierge_handoff_name", "concierge_handoff_phone", "never_say", "terms_accepted", "terms_version", "extra"]);
function extrasOf(body: Body): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (!KNOWN.has(k) && s(v)) out[k] = s(v);
  const nested = body.extra;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) for (const [k, v] of Object.entries(nested as Body)) if (s(v)) out[k] = s(v);
  return out;
}

/** The restaurant an event is about: by the GHL contact id it was matched to before, else by its business name. */
async function restaurantFor(workspaceId: string, body: Body): Promise<Restaurant | null> {
  const contactId = s(body.contact_id);
  if (contactId) {
    const rows = await db.query.partnerRestaurants.findMany({ where: eq(schema.partnerRestaurants.workspaceId, workspaceId) });
    const byContact = rows.find((r) => r.extra.ghl_contact_id === contactId);
    if (byContact) return byContact;
  }
  const business = s(body.business_name);
  return business ? restaurantByRef(workspaceId, business) : null;
}

export type GncResult = { ok: true; note: string; restaurantId: string; created: boolean } | { ok: false; note: string };

export async function handleOrderPaid(workspaceId: string, body: Body): Promise<GncResult> {
  const orderId = s(body.order_id);
  const business = s(body.business_name);
  if (!orderId) return { ok: false, note: "order_id is required" };
  const existing = await restaurantFor(workspaceId, body);
  if (!existing && !business) return { ok: false, note: "business_name is required for a new restaurant" };
  const paidOn = day(body.paid_at) ?? day(body.sent_at) ?? nowIso().slice(0, 10);
  const yearly = /year|annual/i.test(s(body.plan)) || /yearly|annual/i.test(s(body.plan_tag));
  const plan = yearly ? "annual" : "monthly";
  const owner = [[s(body.owner_first_name), s(body.owner_last_name)].filter(Boolean).join(" "), s(body.owner_email), s(body.owner_phone)].filter(Boolean).join(", ");
  const fields: Record<string, unknown> = { plan, paidAt: paidOn };
  if (!existing) Object.assign(fields, { business, source: "in the group", firstContactAt: paidOn, signedAt: paidOn });
  else if (!existing.signedAt) fields.signedAt = paidOn;
  if (!existing || stageIndex(existing.stage) < stageIndex("signed")) fields.stage = "signed";
  if (owner && (!existing || !existing.ownerContact)) fields.ownerContact = owner;
  const r = await upsertRestaurant(workspaceId, { ...fields, ...(existing ? { id: existing.id } : {}) });
  const row = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, r.id) }))!;
  const extra = { ...row.extra, ...extrasOf(body), ...(s(body.contact_id) ? { ghl_contact_id: s(body.contact_id) } : {}), ...(s(body.source_page) ? { ghl_source_page: s(body.source_page) } : {}), ...(s(body.currency) ? { currency: s(body.currency) } : {}) };
  await db.update(schema.partnerRestaurants).set({ extra, updatedAt: nowIso() }).where(eq(schema.partnerRestaurants.id, r.id));
  // One Payment per amount: the plan's recurring amount, and the setup fee when there is one; the order id keeps each to once.
  const recurring = num(body.amount_recurring) ?? num(body.amount_total) ?? 0;
  const setup = num(body.amount_setup) ?? 0;
  const month = paidOn.slice(0, 7);
  const shared = { date: paidOn, status: "paid", processor: "Stripe via GHL", month, tax: num(body.tax) ?? 0, feesDeducted: num(body.processor_fee) ?? 0 };
  const made: string[] = [];
  if (recurring > 0) {
    const p = await addPayment(workspaceId, r.id, { ...shared, plan, amount: recurring, externalId: `gnc:${orderId}:recurring`, note: `GHL order ${orderId}` });
    if (p.created) made.push(`${plan} ${recurring.toFixed(2)}`);
  }
  if (setup > 0) {
    const p = await addPayment(workspaceId, r.id, { ...shared, plan: "setup fee", amount: setup, tax: 0, externalId: `gnc:${orderId}:setup`, note: `GHL order ${orderId}` });
    if (p.created) made.push(`setup ${setup.toFixed(2)}`);
  }
  if (made.length) await addTouch(workspaceId, r.id, { date: paidOn, who: "bot", channel: "bot", note: `GHL order paid: ${made.join(", ")}`, nextStep: "Onboarding form", nextStepDate: paidOn });
  return { ok: true, note: made.length ? `Order ${orderId}: ${made.join(", ")}` : `Order ${orderId} was already on file`, restaurantId: r.id, created: r.created };
}

export async function handleOnboardingSubmitted(workspaceId: string, body: Body): Promise<GncResult> {
  const submissionId = s(body.submission_id);
  if (!submissionId) return { ok: false, note: "submission_id is required" };
  const existing = await restaurantFor(workspaceId, body);
  const business = s(body.business_name);
  if (!existing && !business) return { ok: false, note: "business_name is required for a new restaurant" };
  if (existing?.extra.ghl_last_submission_id === submissionId) return { ok: true, note: `Submission ${submissionId} was already on file`, restaurantId: existing.id, created: false };
  const sentOn = day(body.sent_at) ?? nowIso().slice(0, 10);
  const rewardVisits = num(body.reward_visits);
  const rewardText = s(body.reward_text);
  const handoff = [s(body.concierge_handoff_name), s(body.concierge_handoff_phone)].filter(Boolean).join(", ");
  const fields: Record<string, unknown> = {
    formCompleteAt: sentOn,
    ...(s(body.address) ? { address: s(body.address) } : {}),
    ...(s(body.website) ? { website: s(body.website) } : {}),
    ...(s(body.facebook_url) ? { facebookPage: s(body.facebook_url) } : {}),
    ...(s(body.instagram_url) ? { instagram: s(body.instagram_url) } : {}),
    ...(s(body.google_business_url) ? { googleBusinessProfile: s(body.google_business_url) } : {}),
    ...(s(body.hours) ? { hours: s(body.hours) } : {}),
    ...(s(body.menu_url) ? { menuLink: s(body.menu_url) } : {}),
    ...(s(body.brand_colors) ? { brandColors: s(body.brand_colors) } : {}),
    ...(rewardText ? { reward: rewardVisits ? `${rewardText} after ${rewardVisits} visits` : rewardText } : {}),
    ...(s(body.welcome_offer) ? { welcomeReward: s(body.welcome_offer) } : {}),
    ...(handoff ? { restaurantContactForMessages: handoff } : {}),
    ...(body.terms_accepted === true || /^(true|yes|1)$/i.test(s(body.terms_accepted)) ? { termsAcceptedAt: sentOn } : {}),
  };
  const owner = [s(body.owner_name), s(body.owner_email), s(body.owner_phone)].filter(Boolean).join(", ");
  if (!existing) Object.assign(fields, { business, source: "in the group", firstContactAt: sentOn, ...(owner ? { ownerContact: owner } : {}) });
  else if (!existing.ownerContact && owner) fields.ownerContact = owner;
  if (!existing || stageIndex(existing.stage) < stageIndex("onboarding")) fields.stage = "onboarding";
  const r = await upsertRestaurant(workspaceId, { ...fields, ...(existing ? { id: existing.id } : {}) });
  const row = (await db.query.partnerRestaurants.findFirst({ where: eq(schema.partnerRestaurants.id, r.id) }))!;
  const extra: Record<string, string> = { ...row.extra, ...extrasOf(body), ghl_last_submission_id: submissionId };
  if (s(body.contact_id)) extra.ghl_contact_id = s(body.contact_id);
  if (s(body.logo_url)) extra.logo_url = s(body.logo_url);
  const photos = listOf(body.photo_urls);
  if (photos.length) extra.photo_urls = photos.join(", ");
  const slow = listOf(body.slow_nights);
  if (slow.length) extra.slow_nights = slow.join(", ");
  if (s(body.staff_language)) extra.staff_language = s(body.staff_language);
  if (s(body.never_say)) extra.never_say = s(body.never_say);
  if (s(body.terms_version)) extra.terms_version = s(body.terms_version);
  await db.update(schema.partnerRestaurants).set({ extra, updatedAt: nowIso() }).where(eq(schema.partnerRestaurants.id, r.id));
  await addTouch(workspaceId, r.id, { date: sentOn, who: "bot", channel: "bot", note: "GHL onboarding form submitted: the setup clock can start", nextStep: "Hand to WalletPush", nextStepDate: sentOn });
  return { ok: true, note: `Onboarding form ${submissionId} on file`, restaurantId: r.id, created: r.created };
}

/** The two events by name; anything else is not ours. */
export async function handleGncEvent(workspaceId: string, event: string, body: Body): Promise<GncResult | null> {
  if (event === "gnc.order_paid") return handleOrderPaid(workspaceId, body);
  if (event === "gnc.onboarding_submitted") return handleOnboardingSubmitted(workspaceId, body);
  return null;
}

/** What the sync log keeps of a Partner Program event: the ids and the business, never the owner. */
export function gncLogPayload(body: Body): Record<string, unknown> {
  return { event: s(body.event), business: s(body.business_name), contact_id: s(body.contact_id), order_id: s(body.order_id), submission_id: s(body.submission_id), sent_at: s(body.sent_at) };
}
