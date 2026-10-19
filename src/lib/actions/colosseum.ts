"use server";

/**
 * The Colosseum's writes (rev 699): a shared win, the member's own three switches (photo opt-in, hide, pause), and the coach's
 * workspace switch. Each is the member's own: refused while a coach is switched into a client, so no one can opt a client's
 * photo in for them.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { removeWin, shareWin } from "@/lib/colosseum";
import { blockedFor, blockMember, reportContent, setWinHidden, unblockMember } from "@/lib/blocks";
import { applaud, markApplauseSeen, shareApplausePoints, takeDownApplause, unshareApplausePoints } from "@/lib/applause";

const THEIRS = "The Colosseum settings and wins are {first}'s own.";

export type WinFormState = { error?: string; ok?: true } | null;
export async function shareWinAction(_prev: WinFormState, formData: FormData): Promise<WinFormState> {
  const { workspaceId, userId, v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const r = await shareWin({ workspaceId, userId }, str(formData, "kind"), String(formData.get("text") ?? ""));
  // Sharing a win (H-1171): +10, once a day.
  if (r.ok) await shareApplausePoints({ workspaceId, userId }, v.tz);
  refresh();
  return r.ok ? { ok: true } : { error: r.error };
}

export async function removeWinAction(formData: FormData): Promise<void> {
  const { workspaceId, userId, v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const id = str(formData, "id");
  const win = await db.query.colosseumWins.findFirst({ where: and(eq(schema.colosseumWins.workspaceId, workspaceId), eq(schema.colosseumWins.userId, userId), eq(schema.colosseumWins.id, id)) });
  await removeWin({ workspaceId, userId }, id);
  // A win taken down (H-1171): its applause points come off the winner; a win shared today takes back the share's points.
  if (win) {
    await takeDownApplause({ workspaceId, userId }, id);
    await unshareApplausePoints({ workspaceId, userId }, v.tz, win);
  }
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

// ---------------------------------------------------------------------------------------------------------------------------
// Block a member and report a win or a member (H-735, plan H-745). The member's own, so refused while a coach is switched in;
// the actor is always the signed-in member, and every id from the form is checked against their workspace (src/lib/blocks.ts).

const MEMBERS_ONLY = "Blocking and reporting are for members. Hide a win from Issues and ideas.";

export type BlockState = { ok?: true; error?: string } | null;
export async function blockMemberAction(_prev: BlockState, formData: FormData): Promise<BlockState> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  if (v.role !== "client") return { error: MEMBERS_ONLY };
  const r = await blockMember(v, str(formData, "membershipId"));
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: true };
}

/** Settings → Blocked members: Unblock. */
export async function unblockMemberAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  await unblockMember(v, str(formData, "membershipId"));
  refresh();
}

export type ContentReportState = { ok?: true; error?: string; support?: true } | null;
export async function reportContentAction(_prev: ContentReportState, formData: FormData): Promise<ContentReportState> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  if (v.role !== "client") return { error: MEMBERS_ONLY };
  const r = await reportContent(v, { targetKind: str(formData, "targetKind"), targetId: str(formData, "targetId"), reason: str(formData, "reason"), note: String(formData.get("note") ?? "") });
  if (!r.ok) return r.support ? { error: r.error, support: true } : { error: r.error };
  refresh();
  return { ok: true };
}

/** Coach → Issues and ideas: Hide this win for everyone, or show it again. The coach's own workspace only. */
export async function hideWinAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await setWinHidden({ workspaceId: coach.workspace.id, userId: coach.user.id }, str(formData, "winId"), str(formData, "hidden") === "1");
  refresh();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Applause (H-1171, plan H-1177): 👏 on another member's win, as a toggle; the member's own, so refused while switched in.

export type ApplaudState = { on?: boolean; error?: string } | null;
export async function applaudAction(_prev: ApplaudState, formData: FormData): Promise<ApplaudState> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  if (v.team) return { error: "Applause is the member's own." };
  const r = await applaud(
    { workspaceId: v.workspace.id, userId: v.user.id, role: v.role, tz: v.tz, firstName: (v.user.name ?? "").trim().split(/\s+/)[0] || "Your coach" },
    str(formData, "winId"),
    str(formData, "on") === "1",
    await blockedFor(v),
  );
  refresh();
  return r.ok ? { on: r.on } : { error: r.error };
}

/** ✕ on Today's "N people applauded your win". */
export async function dismissApplauseAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto || v.team) return;
  await markApplauseSeen(v.membership.id);
  refresh();
}
