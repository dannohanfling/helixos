"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { CLIENT_NAME_FIX_OPEN, type FixOutcome } from "@/lib/engine/pass-fix";
import { ownProgram } from "@/lib/eo-pass";
import { fixPassName } from "@/lib/pass-fix";

/**
 * Fix my pass (H-1699, plan H-1701 approved in H-1702). Coach only, never while switched into a client. "Fix my pass" writes the
 * coach's own HelixOS name onto the coach's own pass: the one test that proves whether names update in place. "Fix this pass"
 * does the same for one client, and stays shut until the coach has ticked "Names update in place" after their own test.
 */
export async function fixMyPassAction(): Promise<void> {
  const coach = await requireCoach();
  const back = (code: FixOutcome) => redirect(`/coach?passFix=${code}&connections=open#own-program`);
  if (coach.switchedInto) back("notready");
  const feed = await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.membershipId, coach.membership.id), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
  if (!feed) back("notready");
  const m = coach.membership;
  if (!m.eoPassSerial || !m.eoPassTypeId) back("nopass");
  back(await fixPassName(feed!, m, coach.user.name));
}

export async function fixMemberPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const back = (code: FixOutcome) => redirect(`/coach?passFixRow=${code}&connections=open`);
  if (!CLIENT_NAME_FIX_OPEN) back("locked");
  if (coach.switchedInto) back("notready");
  const feed = await ownProgram(coach.workspace.id);
  if (!feed) back("notready");
  if (!feed!.nameFixProven) back("proving");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m?.eoPassSerial || !m.eoPassTypeId) back("nopass");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, m!.userId), columns: { name: true } });
  back(await fixPassName(feed!, m!, user?.name ?? ""));
}

/** The coach's two switches: names update in place (ticked after their own test), and fix on a member's name change (only once proven). */
export async function setNameFixAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (!CLIENT_NAME_FIX_OPEN || coach.switchedInto) return;
  const feed = await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.membershipId, coach.membership.id), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
  if (!feed) return;
  const proven = formData.get("nameFixProven") === "on";
  await db
    .update(schema.leaderboardFeeds)
    .set({ nameFixProven: proven, fixNamesOnChange: proven && formData.get("fixNamesOnChange") === "on", updatedAt: nowIso() })
    .where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}

/**
 * Make my pass again (H-1905, plan H-1906 approved in H-1916): the coach's own pass only, to move to a new template. HelixOS
 * forgets the old pass's ids so Get my pass makes a new one, marks the coach's points as not sent yet so the next sync sends
 * one opening add of the full total to the new pass, and clears the pass's sent marks. Nothing is written to or deleted
 * from the pass service; the old pass and its record stay there.
 */
export async function remakeMyPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) redirect("/coach?passRemade=no&connections=open#own-program");
  if (formData.get("confirm") !== "on") redirect("/coach?passRemade=confirm&connections=open#own-program");
  const m = coach.membership;
  await db
    .update(schema.memberships)
    .set({ eoCustomerId: null, eoPassSerial: null, eoPassTypeId: null, eoPassUrl: null, eoPassInstalledAt: null, eoPassLastPushAt: null, eoLevelSent: null, eoTierSent: null, eoNameNeedsFix: false, eoOffersSent: [] })
    .where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, coach.workspace.id)));
  await db.update(schema.pointsLedger).set({ eoMirrored: false }).where(and(eq(schema.pointsLedger.workspaceId, coach.workspace.id), eq(schema.pointsLedger.userId, coach.user.id)));
  console.log("[pass-fix] own pass to be made again");
  redirect("/coach?passRemade=yes&connections=open#own-program");
}
