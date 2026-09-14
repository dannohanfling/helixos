import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { PLACEHOLDER_PROMPTS, placeholdersOf, type AssembledBeat, type Fills, type QuestionLike } from "@/lib/engine/socrates";

/** The library (owner-less rows, in seed order) plus this client's own questions. A client never sees another client's. */
export async function visibleQuestions(userId: string): Promise<QuestionLike[]> {
  const rows = await db.query.socratesQuestions.findMany({ where: or(isNull(schema.socratesQuestions.userId), eq(schema.socratesQuestions.userId, userId)), orderBy: [asc(schema.socratesQuestions.key), asc(schema.socratesQuestions.createdAt)] });
  const library = rows.filter((r) => r.userId === null);
  const own = rows.filter((r) => r.userId === userId);
  return [...library, ...own].map((r) => ({ id: r.id, question: r.question, clarityStage: r.clarityStage, nepqCategory: r.nepqCategory, source: r.source, scriptTypes: r.scriptTypes, own: r.userId === userId }));
}

export async function ownScript(id: string, userId: string) {
  return db.query.socratesScripts.findFirst({ where: and(eq(schema.socratesScripts.id, id), eq(schema.socratesScripts.userId, userId)) });
}

/** The offer a script's `[3 pillars]` blank is prefilled from: the live one, else the newest; its path steps, joined. */
export async function offerPillars(userId: string): Promise<{ name: string; pillars: string } | null> {
  const offers = await db.query.offers.findMany({ where: eq(schema.offers.userId, userId), orderBy: [desc(schema.offers.createdAt)] });
  const o = offers.find((x) => x.status === "live") ?? offers[0];
  if (!o) return null;
  const steps = (o.pathSteps ?? []).map((x) => x.trim()).filter(Boolean);
  return { name: o.name, pillars: steps.join(", ") };
}

/**
 * The fills the outputs use: what the client saved, and for a blank the offer answers, the offer's value until the client
 * types over it. The offer is the source, not a suggestion, so a script whose fill step was never opened still reads it.
 */
export async function fillsFor(assembled: AssembledBeat[], saved: Fills, userId: string): Promise<{ fills: Fills; offer: { name: string; pillars: string } | null }> {
  const wantsOffer = placeholdersOf(assembled).some((k) => PLACEHOLDER_PROMPTS[k]?.source === "offer");
  const offer = wantsOffer ? await offerPillars(userId) : null;
  const fills: Fills = { ...saved };
  if (offer?.pillars) for (const k of placeholdersOf(assembled)) if (PLACEHOLDER_PROMPTS[k]?.source === "offer" && !fills[k]?.trim()) fills[k] = offer.pillars;
  return { fills, offer };
}
