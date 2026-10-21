"use server";

/**
 * My Helix's writes (rev 707): a member's tick on a rung (or the coach's for them, logged as the coach's change), "Pause the
 * helix" remembered, the once-glow remembered, and the coach's edits to the rung list.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { markSeen, saveRung, tickRung } from "@/lib/my-helix";

/** Tick a rung, or clear the tick. While switched in, the coach ticks it for the client and the change is logged as theirs. */
export async function tickRungAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await tickRung({ workspaceId, userId }, str(formData, "key"), str(formData, "on") === "1", v.actor.id, opt(formData, "reason"));
  refresh();
}

/** "Pause the helix", remembered per member. */
export async function setHelixPausedAction(paused: boolean): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  await db.update(schema.memberships).set({ helixPaused: paused === true }).where(eq(schema.memberships.id, v.membership.id));
}

/** The rungs just seen lit, so their glow never repeats. The member's own: a coach switched in sees the glow and remembers nothing. */
export async function markHelixSeenAction(keys: string[]): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto || !Array.isArray(keys)) return;
  await markSeen(v.membership.id, v.membership.helixSeen ?? [], keys.filter((k) => typeof k === "string").slice(0, 100));
}

export type RungFormState = { error?: string; ok?: true } | null;
/** The coach edits one rung: name, order, link and what it reads. */
export async function saveRungAction(_prev: RungFormState, formData: FormData): Promise<RungFormState> {
  await requireCoach();
  const r = await saveRung(str(formData, "key"), { label: str(formData, "label"), order: num(formData, "order"), href: str(formData, "href"), signal: str(formData, "signal") });
  refresh();
  return "error" in r ? { error: r.error } : { ok: true };
}
