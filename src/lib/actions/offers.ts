"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { OFFER_CONTAINERS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ctx, num, opt, refresh, str } from "./common";

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
      container: OFFER_CONTAINERS.find((c) => c === str(formData, "container")) ?? "Group program",
      length: opt(formData, "length"),
      price: num(formData, "price"),
      paymentPlan: opt(formData, "paymentPlan"),
      guarantee: opt(formData, "guarantee"),
      scarcity: opt(formData, "scarcity"),
      urgency: opt(formData, "urgency"),
      oneBelief: opt(formData, "oneBelief"),
      difference: opt(formData, "difference"),
      whyNow: opt(formData, "whyNow"),
      whyTrust: opt(formData, "whyTrust"),
      howItWorks: opt(formData, "howItWorks"),
      forYouIf: opt(formData, "forYouIf"),
      notForYouIf: opt(formData, "notForYouIf"),
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
  await db.delete(schema.offers).where(eq(schema.offers.id, id));
  refresh();
  redirect("/offers");
}
