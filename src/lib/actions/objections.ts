"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { BELIEF_KEYS, type BeliefKey } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { LEGACY_OFFER_OBJECTIONS } from "@/lib/engine/objections";

const beliefOf = (raw: string): BeliefKey | null => (BELIEF_KEYS as readonly string[]).includes(raw) ? (raw as BeliefKey) : null;
const reframesOf = (formData: FormData): string[] => formData.getAll("reframes").map(String).map((r) => r.trim()).filter(Boolean);

/** A client's own objection: their words, what is underneath, which belief, one or more reframes. */
export async function createObjectionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  if (!name) return;
  const [reframe, ...rest] = reframesOf(formData);
  await db.insert(schema.libraryAssets).values({ id: newId(), workspaceId, userId, type: "objection", name, body: str(formData, "body") || name, reframe: reframe ?? null, reframes: rest, underneath: opt(formData, "underneath"), belief: beliefOf(str(formData, "belief")), proof: opt(formData, "proof"), useWhen: opt(formData, "useWhen"), tag: opt(formData, "tag") });
  refresh();
  redirect("/socrates/objections");
}

export async function updateObjectionAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const [reframe, ...rest] = reframesOf(formData);
  await db
    .update(schema.libraryAssets)
    .set({ name: str(formData, "name") || undefined, body: str(formData, "body") || undefined, reframe: reframe ?? null, reframes: rest, underneath: opt(formData, "underneath"), belief: beliefOf(str(formData, "belief")), proof: opt(formData, "proof"), useWhen: opt(formData, "useWhen") })
    .where(and(eq(schema.libraryAssets.id, id), eq(schema.libraryAssets.userId, userId), eq(schema.libraryAssets.type, "objection")));
  refresh();
  redirect(`/socrates/objections#o-${id}`);
}

export async function deleteObjectionAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.libraryAssets).where(and(eq(schema.libraryAssets.id, str(formData, "id")), eq(schema.libraryAssets.userId, userId), eq(schema.libraryAssets.type, "objection")));
  refresh();
  redirect("/socrates/objections");
}

/**
 * One of the offer wizard's older fixed answers becomes a record in the bank, linked to the offer, and the field is cleared:
 * one place to answer the question from then on. The optimiser's count is unchanged by the move.
 */
export async function moveLegacyObjectionAction(field: string, formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  // Posted from the offer's own form: the offer id is its hidden "id"; the field is bound to the button (a button's name is overridden by React when its formAction is a function).
  const offerId = str(formData, "id");
  const legacy = LEGACY_OFFER_OBJECTIONS.find((l) => l.field === field);
  const offer = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, offerId), eq(schema.offers.userId, userId)) });
  if (!offer || !legacy) return;
  const answer = (offer[legacy.field] ?? "").trim();
  if (!answer) return;
  const id = newId();
  await db.insert(schema.libraryAssets).values({ id, workspaceId, userId, type: "objection", name: legacy.name, body: legacy.name, reframe: answer, reframes: [], tag: "From the offer wizard" });
  await db.update(schema.offers).set({ [legacy.field]: null, objectionAssetIds: [...offer.objectionAssetIds, id] }).where(eq(schema.offers.id, offerId));
  refresh();
  redirect(`/offers/${offerId}#objections`);
}

/** Template objections never change from a client's page; this exists so the shared set is visibly read-only. */
export async function noopSharedObjectionAction(): Promise<void> {
  await ctx();
  void isNull;
}
