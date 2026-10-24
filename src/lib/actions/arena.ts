"use server";

/**
 * 30 Days in the Arena (H-1562): "I'm in". The member's own choice, so a coach switched into a client can't tap it for them
 * and a team member can't tap it for their owner. Once per member; joining closes at the end of Thu 26 Nov, Pacific.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx, str } from "@/lib/action-helpers";
import { requireCoach } from "@/lib/auth";
import { arenaFor, checkInHuddle, enroll, movePod, newPod, placePods, setCaptain } from "@/lib/arena";
import { ARENA, canEnter, dateIn, joinOpen } from "@/lib/engine/arena";

export async function joinArenaAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Joining the Arena is the member's own choice." });
  // Where "I'm in" was pressed: Today, Colosseum → Challenges (H-1844), or the Arena page.
  const from = formData.get("from");
  const back = (arena: string) =>
    from === "today" ? `/today?arena=${arena}#arena` : from === "colosseum" ? `/rewards?tab=colosseum&section=challenges&arena=${arena}` : `/arena?arena=${arena}#arena`;
  if (!canEnter({ role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) })) redirect(back("not-yours"));
  const c = await arenaFor(v.workspace.id);
  if (!joinOpen(c, dateIn(ARENA.timezone, new Date()))) redirect(back("closed"));
  await enroll({ challengeId: c.id, workspaceId: v.workspace.id, userId: v.user.id, membershipId: v.membership.id });
  revalidatePath("/today");
  redirect(back("in"));
}

/**
 * "I'm here" at the live Huddle (H-1563 PR B): the member's own, once per Huddle, 10 points. A coach switched in and a team
 * member can't tap it for them.
 */
export async function huddleHereAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Checking in to a Huddle is the member's own." });
  const back = (huddle: string) => `/arena?huddle=${encodeURIComponent(huddle)}#huddles`;
  if (!canEnter({ role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) })) redirect(back("not-yours"));
  const c = await arenaFor(v.workspace.id);
  const r = await checkInHuddle({ c, workspaceId: v.workspace.id, userId: v.user.id, membershipId: v.membership.id });
  revalidatePath("/arena");
  redirect(back(r.ok ? (r.scored ? "here" : "already") : r.error));
}

/** The coach's pods (PR B): back to the Pods card with what happened. */
const podsBack = (note: string) => `/coach/arena?pods=${encodeURIComponent(note)}#pods`;

export async function movePodAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const c = await arenaFor(v.workspace.id);
  const r = await movePod(c, str(formData, "membershipId"), str(formData, "podId"));
  revalidatePath("/coach/arena");
  revalidatePath("/arena");
  redirect(podsBack(r.ok ? "moved" : r.error!));
}

export async function captainAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const c = await arenaFor(v.workspace.id);
  const r = await setCaptain(c, str(formData, "podId"), str(formData, "membershipId"));
  revalidatePath("/coach/arena");
  revalidatePath("/arena");
  redirect(podsBack(r.ok ? "captain" : r.error!));
}

export async function newPodAction(): Promise<void> {
  const v = await requireCoach();
  const c = await arenaFor(v.workspace.id);
  await placePods(c.id, v.workspace.id);
  await newPod(c);
  revalidatePath("/coach/arena");
  redirect(podsBack("new"));
}
