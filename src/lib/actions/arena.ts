"use server";

/**
 * 30 Days in the Arena (H-1562): "I'm in". The member's own choice, so a coach switched into a client can't tap it for them
 * and a team member can't tap it for their owner. Once per member; joining closes at the end of Thu 26 Nov, Pacific.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/action-helpers";
import { arenaFor, enroll } from "@/lib/arena";
import { ARENA, canEnter, dateIn, joinOpen } from "@/lib/engine/arena";

export async function joinArenaAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Joining the Arena is the member's own choice." });
  const back = formData.get("from") === "today" ? "/today" : "/arena";
  if (!canEnter({ role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) })) redirect(`${back}?arena=not-yours`);
  const c = await arenaFor(v.workspace.id);
  if (!joinOpen(c, dateIn(ARENA.timezone, new Date()))) redirect(`${back}?arena=closed`);
  await enroll({ challengeId: c.id, workspaceId: v.workspace.id, userId: v.user.id, membershipId: v.membership.id });
  revalidatePath("/today");
  redirect(`${back}?arena=in#arena`);
}
