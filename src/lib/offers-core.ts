/**
 * Offers, the one copy of how one starts: a draft, never on the bot (its bot role stays "not on bot" until the member sets it).
 * The Offers page's "New offer" and the Board's set-up both call it.
 */
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { queueProgress } from "@/lib/chat-progress";

export type NewOffer = { name: string; promise?: string | null; price?: number | null; notes?: string | null };

/** A new draft offer for the member. Returns its id. */
export async function createOffer(m: { workspaceId: string; userId: string }, o: NewOffer): Promise<string> {
  const id = newId();
  await db.insert(schema.offers).values({ id, workspaceId: m.workspaceId, userId: m.userId, name: o.name.trim() || "New offer", promise: o.promise || null, price: o.price ?? 0, notes: o.notes ?? null, status: "draft", botRole: "not_on_bot" });
  queueProgress(m.workspaceId, m.userId, "offer_changed");
  return id;
}
