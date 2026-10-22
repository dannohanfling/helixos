"use server";

/**
 * The photo rooms' "Golden hour / Night" toggle (revs 711, 720, 738): the member's own choice, remembered on their membership and
 * shared by the Council Chamber, the Colosseum and the Aqueduct. A coach switched in never changes it.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx, refresh, str } from "@/lib/action-helpers";

export async function setSceneLookAction(look: "day" | "night"): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  if (look !== "day" && look !== "night") return;
  await db.update(schema.memberships).set({ sceneLook: look }).where(eq(schema.memberships.id, v.membership.id));
}

/** The living scenes' sounds (H-400): one switch, on by default, the member's own; a coach switched in is refused. */
export async function setSoundsOnAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The sounds switch is {first}'s own." });
  await db.update(schema.memberships).set({ soundsOn: str(formData, "soundsOn") === "on" }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

/** "Scene motion" (Roma Vivit 2 PR 6, H-1060): one switch, on by default, the member's own; a coach switched in is refused. */
export async function setSceneMotionAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The Scene motion switch is {first}'s own." });
  await db.update(schema.memberships).set({ sceneMotion: str(formData, "sceneMotion") === "on" }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}
