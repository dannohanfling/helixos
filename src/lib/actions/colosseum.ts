"use server";

/**
 * The Colosseum's writes (rev 699): a shared win, the member's own three switches (photo opt-in, hide, pause), and the coach's
 * workspace switch. Each is the member's own: refused while a coach is switched into a client, so no one can opt a client's
 * photo in for them.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { removeWin, shareWin } from "@/lib/colosseum";

const THEIRS = "The Colosseum settings and wins are {first}'s own.";

export type WinFormState = { error?: string; ok?: true } | null;
export async function shareWinAction(_prev: WinFormState, formData: FormData): Promise<WinFormState> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const r = await shareWin({ workspaceId, userId }, str(formData, "kind"), String(formData.get("text") ?? ""));
  refresh();
  return r.ok ? { ok: true } : { error: r.error };
}

export async function removeWinAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  await removeWin({ workspaceId, userId }, str(formData, "id"));
  refresh();
}

/** "Show my photo in the Colosseum": off by default, only the member turns it on. */
export async function setArenaPhotoAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  await db.update(schema.memberships).set({ arenaPhoto: str(formData, "arenaPhoto") === "on" }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

/** "Hide me from the arena": out of the arena and the standings, the page still theirs to see. */
export async function setArenaHiddenAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  await db.update(schema.memberships).set({ arenaHidden: str(formData, "arenaHidden") === "on" }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

/** Pause the arena, remembered per member. */
export async function setArenaPausedAction(paused: boolean): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  await db.update(schema.memberships).set({ arenaPaused: paused === true }).where(eq(schema.memberships.id, v.membership.id));
}

/** The coach's switch for the workspace: off by default, on when they say so. */
export async function setColosseumOnAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await db.update(schema.workspaces).set({ colosseumOn: str(formData, "colosseumOn") === "on" }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}
