import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { completion, essenceOver, normalizeEssence, serializeEssence, type EssenceData } from "@/lib/engine/essence";

/** The client's Essence, normalised; an empty object when they have not started. Once per request. */
export const essenceFor = cache(async (workspaceId: string, userId: string): Promise<EssenceData> => {
  const row = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, workspaceId), eq(schema.essences.userId, userId)) });
  return normalizeEssence(row?.data ?? {});
});

/** The serialised block that leads every system message, or null when the Essence is empty or over the cap until trimmed. */
export async function essenceBlockFor(workspaceId: string, userId: string): Promise<string | null> {
  const data = await essenceFor(workspaceId, userId);
  return essenceOver(data) ? null : serializeEssence(data);
}

/** What a page shows next to a ✨ action: sections filled, and whether the output will read generic. */
export async function voiceState(workspaceId: string, userId: string): Promise<{ filled: number; total: number; ready: boolean }> {
  const data = await essenceFor(workspaceId, userId);
  const c = completion(data);
  return { filled: c.filled, total: c.total, ready: !c.empty && !essenceOver(data) };
}
