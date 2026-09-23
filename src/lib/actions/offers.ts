"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { CURRENCIES } from "@/lib/engine/offer-score";
import { OFFER_CONTAINERS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

async function own(id: string, userId: string) {
  const o = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, id), eq(schema.offers.userId, userId)) });
  if (!o) throw new Error("Offer not found");
  return o;
}

export async function createOfferAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = newId();
  await db.insert(schema.offers).values({ id, workspaceId, userId, name: str(formData, "name") || "New offer", promise: opt(formData, "promise"), price: num(formData, "price") });
  refresh();
  redirect(`/offers/${id}`);
}

export async function updateOfferAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  const steps = [1, 2, 3, 4, 5].map((i) => str(formData, `step${i}`)).filter(Boolean);
  const status = (["draft", "live", "retired"] as const).find((s) => s === str(formData, "status"));
  await db
    .update(schema.offers)
    .set({
      name: str(formData, "name") || undefined,
      ...(status ? { status } : {}),
      avatar: opt(formData, "avatar"),
      coreProblem: opt(formData, "coreProblem"),
      promise: opt(formData, "promise"),
      mechanismName: opt(formData, "mechanismName"),
      pathSteps: steps,
      container: OFFER_CONTAINERS.find((c) => c === str(formData, "container")) ?? "",
      currency: CURRENCIES.find((c) => c === str(formData, "currency").toUpperCase()) ?? "USD",
      length: opt(formData, "length"),
      price: num(formData, "price"),
      // The tick sits in the same form as the price, so an unticked box is a deliberate "quote it".
      neverQuotePrice: formData.get("neverQuotePrice") === "on",
      paymentPlan: opt(formData, "paymentPlan"),
      guarantee: opt(formData, "guarantee"),
      scarcity: opt(formData, "scarcity"),
      urgency: opt(formData, "urgency"),
      ctaFooter: opt(formData, "ctaFooter"),
      oneBelief: opt(formData, "oneBelief"),
      difference: opt(formData, "difference"),
      whyNow: opt(formData, "whyNow"),
      whyTrust: opt(formData, "whyTrust"),
      howItWorks: opt(formData, "howItWorks"),
      forYouIf: opt(formData, "forYouIf"),
      notForYouIf: opt(formData, "notForYouIf"),
      qualifyingQuestion1: opt(formData, "qualifyingQuestion1"),
      qualifyingQuestion2: opt(formData, "qualifyingQuestion2"),
      qualifyingQuestion3: opt(formData, "qualifyingQuestion3"),
      objectionAssetIds: formData.getAll("objectionAssetIds").map(String).filter(Boolean),
      objTime: opt(formData, "objTime"),
      objMoney: opt(formData, "objMoney"),
      objPartner: opt(formData, "objPartner"),
      objTriedBefore: opt(formData, "objTriedBefore"),
      objDiy: opt(formData, "objDiy"),
      salesPageUrl: opt(formData, "salesPageUrl"),
      paymentLink: opt(formData, "paymentLink"),
      notes: opt(formData, "notes"),
    })
    .where(eq(schema.offers.id, id));
  refresh();
  const anchor = str(formData, "anchor");
  redirect(`/offers/${id}${anchor ? `#${anchor}` : ""}`);
}

export async function addComponentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const offerId = str(formData, "offerId");
  await own(offerId, userId);
  const name = str(formData, "name");
  if (!name) return;
  const existing = await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, offerId) });
  await db.insert(schema.offerComponents).values({
    id: newId(),
    offerId,
    name,
    type: (["core", "bonus", "guarantee"] as const).find((t) => t === str(formData, "type")) ?? "core",
    description: opt(formData, "description"),
    perceivedValue: num(formData, "perceivedValue"),
    order: existing.length + 1,
    beliefBreak: (["vehicle", "internal", "external", "none"] as const).find((b) => b === str(formData, "beliefBreak")) ?? "none",
    problemItSolves: opt(formData, "problemItSolves"),
  });
  refresh();
  redirect(`/offers/${offerId}#stack`);
}

export async function updateComponentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const comp = await db.query.offerComponents.findFirst({ where: eq(schema.offerComponents.id, id) });
  if (!comp) return;
  await own(comp.offerId, userId);
  if (str(formData, "delete") === "1") {
    await db.delete(schema.offerComponents).where(eq(schema.offerComponents.id, id));
  } else {
    await db
      .update(schema.offerComponents)
      .set({
        name: str(formData, "name") || comp.name,
        type: (["core", "bonus", "guarantee"] as const).find((t) => t === str(formData, "type")) ?? comp.type,
        perceivedValue: num(formData, "perceivedValue"),
        beliefBreak: (["vehicle", "internal", "external", "none"] as const).find((b) => b === str(formData, "beliefBreak")) ?? comp.beliefBreak,
        description: opt(formData, "description"),
      })
      .where(eq(schema.offerComponents.id, id));
  }
  refresh();
  redirect(`/offers/${comp.offerId}#stack`);
}

export async function deleteOfferAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  // Client records name their program by this offer's id with no foreign key, so a delete would leave them pointing at nothing
  // and reading "No program". Refused while any do, the same rule a move would follow for an offer with sales on record.
  const named = await db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.offerId, id), eq(schema.clientRecords.userId, userId)), columns: { id: true } });
  if (named.length) {
    const n = named.length;
    redirect(`/offers/${id}?error=${encodeURIComponent(`Not deleted: ${n} client ${n === 1 ? "record names" : "records name"} this offer as ${n === 1 ? "its" : "their"} program. Give ${n === 1 ? "it" : "them"} another program, or clear it, on the Clients page, then delete.`)}`);
  }
  await db.delete(schema.offers).where(eq(schema.offers.id, id));
  refresh();
  redirect(deletedTo("/offers", "offer"));
}
