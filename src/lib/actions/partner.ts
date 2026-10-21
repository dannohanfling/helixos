"use server";

/**
 * The Partner Program's actions (H-1307, plan H-1361): the coach's own, signed in. A restaurant saved or added, a touch, a
 * payment, the month's statement built, approved by Danno, or given an adjustment line. Nothing here pays anyone, sends
 * anything or writes to Airtable; Approve only stamps the lines.
 */
import { redirect } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { setAgentPartnerScope } from "@/lib/handoff";
import { addAdjustment, addPayment, addTouch, approvePayouts, buildPayouts, restaurantById, upsertRestaurant } from "@/lib/partner";

const RESTAURANT_KEYS = [
  "business", "type", "city", "source", "referredBy", "stage", "plan", "foundingPartner",
  "firstContactAt", "demoAt", "signedAt", "paidAt", "formCompleteAt", "handedToWalletpushAt", "liveAt", "featuredInGroupAt", "cancelledAt", "setupApprovedAt",
  "walletpushStatus", "walletpushNote", "googleReviewsAtStart", "googleRatingAtStart", "passHolders", "reviewsGained", "conciergeChats", "resultsAsOf",
  "risk", "cancelReason", "nextStep", "nextStepDate", "notes",
  "address", "businessPhone", "website", "facebookPage", "instagram", "ownerContact", "brandColors", "hours", "menuLink", "googleBusinessProfile", "reservationLink",
  "reward", "welcomeReward", "conciergeVoice", "topCustomerQuestions", "restaurantContactForMessages", "termsAcceptedAt", "featureConsent", "directoryCard",
] as const;

function fields(fd: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (fd.has(k)) out[k] = str(fd, k);
  return out;
}

/** The form on a restaurant's page, or the Add form on the program page: the fields it carries, nothing it leaves out. */
export async function saveRestaurantAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  const input = fields(formData, RESTAURANT_KEYS);
  // A checkbox left unticked is absent from the form: on the edit form that means off.
  if (id) for (const k of ["foundingPartner", "featureConsent"]) input[k] ??= "";
  if (!input.business && !id) redirect(`/coach/partners?error=${encodeURIComponent("A restaurant needs its business name.")}#add`);
  if (id && !(await restaurantById(coach.workspace.id, id, coach.today))) redirect("/coach/partners");
  const r = await upsertRestaurant(coach.workspace.id, { ...input, ...(id ? { id } : {}) });
  refresh();
  redirect(`/coach/partners/${r.id}?saved=1`);
}

export async function addTouchAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const restaurantId = str(formData, "restaurantId");
  if (!(await restaurantById(coach.workspace.id, restaurantId, coach.today))) redirect("/coach/partners");
  await addTouch(coach.workspace.id, restaurantId, fields(formData, ["date", "who", "channel", "firstConversation", "note", "nextStep", "nextStepDate"]));
  refresh();
  redirect(`/coach/partners/${restaurantId}?touched=1#touches`);
}

export async function addPaymentAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const restaurantId = str(formData, "restaurantId");
  if (!(await restaurantById(coach.workspace.id, restaurantId, coach.today))) redirect("/coach/partners");
  try {
    await addPayment(coach.workspace.id, restaurantId, fields(formData, ["date", "plan", "amount", "tax", "feesDeducted", "promo", "status", "processor", "month", "externalId", "note"]));
  } catch (e) {
    redirect(`/coach/partners/${restaurantId}?error=${encodeURIComponent(e instanceof Error ? e.message : "That payment couldn't be saved.")}#payments`);
  }
  refresh();
  redirect(`/coach/partners/${restaurantId}?paid=1#payments`);
}

const monthOf = (fd: FormData) => (/^\d{4}-\d{2}$/.test(str(fd, "month")) ? str(fd, "month") : "");

/** Build the month's statement from the payments on file; Danno's approved lines stay, the rest are rebuilt. */
export async function buildPayoutsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const month = monthOf(formData);
  if (!month) redirect("/coach/partners#statement");
  const r = await buildPayouts(coach.workspace.id, month, { feesOffFirst: str(formData, "feesOffFirst") === "1" });
  refresh();
  redirect(`/coach/partners?month=${month}&built=${r.built}&kept=${r.kept}${str(formData, "feesOffFirst") === "1" ? "&fees=1" : ""}#statement`);
}

/** Danno's Approve on the statement: every open line of the month is stamped. Nothing is paid from here. */
export async function approvePayoutsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const month = monthOf(formData);
  if (!month) redirect("/coach/partners#statement");
  const n = await approvePayouts(coach.workspace.id, month);
  refresh();
  redirect(`/coach/partners?month=${month}&approved=${n}#statement`);
}

export async function addAdjustmentAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const month = monthOf(formData);
  const restaurantId = str(formData, "restaurantId");
  const amount = Number(str(formData, "amount").replace(/[^0-9.-]/g, ""));
  if (!month || !restaurantId || !Number.isFinite(amount) || amount === 0) redirect(`/coach/partners?month=${month}&error=${encodeURIComponent("An adjustment needs a restaurant and an amount.")}#statement`);
  if (!(await restaurantById(coach.workspace.id, restaurantId, coach.today))) redirect("/coach/partners");
  await addAdjustment(coach.workspace.id, restaurantId, month, amount, str(formData, "note"));
  refresh();
  redirect(`/coach/partners?month=${month}#statement`);
}

/** Partner Program tools on an agent's token (Coach → Agents): on or off for that agent's live token. */
export async function setAgentPartnerScopeAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const agentId = str(formData, "agentId");
  await setAgentPartnerScope({ workspaceId: coach.workspace.id, userId: coach.user.id }, agentId, str(formData, "on") === "1");
  refresh();
  redirect(`/coach/agents#agent-${encodeURIComponent(agentId)}`);
}
