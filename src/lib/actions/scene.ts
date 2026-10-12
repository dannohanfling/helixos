"use server";

/**
 * The photo rooms' "Golden hour / Night" toggle (revs 711, 720, 738): the member's own choice, remembered on their membership and
 * shared by the Council Chamber, the Colosseum and the Aqueduct. A coach switched in never changes it.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";

export async function setSceneLookAction(look: "day" | "night"): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  if (look !== "day" && look !== "night") return;
  await db.update(schema.memberships).set({ sceneLook: look }).where(eq(schema.memberships.id, v.membership.id));
}
