"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getViewer, requireCoach } from "@/lib/auth";
import { ctx, str } from "@/lib/action-helpers";
import { readSession, writeSession } from "@/lib/session";
import { logSwitch } from "@/lib/switch";
import { logSync } from "@/lib/integrations";
import { nowIso } from "@/lib/dates";

/**
 * "Switch to client" (rev 216): a coach goes into one client's HelixOS, to look (View) or to set it up for them (Work, only
 * when the client lets their coach work in it). The session stays the coach's own; the switch is a part of it, checked again
 * on every request. Only a coach of the same workspace, into a client who isn't removed.
 */
export async function switchToClientAction(formData: FormData): Promise<void> {
  // A coach already switched is, to the app, the client: requireCoach sends them to Today. One switch at a time.
  const v = await requireCoach();
  const id = str(formData, "membershipId");
  const cm = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, id), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!cm || cm.role !== "client" || cm.removedAt) redirect("/coach?error=" + encodeURIComponent("That client can't be switched into."));
  // One Open per client (H-164 §6): a chosen mode, or, with none sent, the one remembered for this client (View until a first
  // Work). Work needs the client's consent either way.
  const asked = str(formData, "mode");
  const wantsWork = asked === "work" || (!asked && cm!.coachOpenMode === "work");
  if (asked === "work" && !cm!.coachCanWork) redirect(`/coach/${cm!.id}?error=${encodeURIComponent("This client hasn't let their coach work in their HelixOS. You can still view it.")}`);
  const mode = wantsWork && cm!.coachCanWork ? "work" : "view";
  const session = (await readSession())!;
  await writeSession({ userId: session.userId, workspaceId: session.workspaceId, role: session.role, sv: session.sv, sw: { m: cm!.id, mode } });
  await logSwitch({ workspaceId: v.workspace.id, clientMembershipId: cm!.id, userId: cm!.userId, coachUserId: v.user.id, kind: "switch_in", mode });
  if (cm!.coachOpenMode !== mode) await db.update(schema.memberships).set({ coachOpenMode: mode }).where(eq(schema.memberships.id, cm!.id));
  redirect("/today");
}

/**
 * "Switch to Work" on the coach banner (H-164 §6): from View to Work inside the same switch, when the client allows it. Logged
 * like a switch in, and remembered for this client.
 */
export async function switchToWorkAction(): Promise<void> {
  const session = await readSession();
  if (!session?.sw) redirect("/today");
  const v = await getViewer();
  if (!v?.switchedInto || v.switchedInto.mode === "work") redirect("/today");
  const cm = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, v.switchedInto.membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!cm || !cm.coachCanWork) redirect(`/today?switchError=${encodeURIComponent("This client hasn't let their coach work in their HelixOS. You can still view it.")}`);
  await writeSession({ userId: session!.userId, workspaceId: session!.workspaceId, role: session!.role, sv: session!.sv, sw: { m: cm!.id, mode: "work" } });
  await logSwitch({ workspaceId: v.workspace.id, clientMembershipId: cm!.id, userId: cm!.userId, coachUserId: v.actor.id, kind: "switch_in", mode: "work" });
  await db.update(schema.memberships).set({ coachOpenMode: "work" }).where(eq(schema.memberships.id, cm!.id));
  redirect("/today");
}

/** The Test tick on a client's page (H-164 §8): labelled Test and sorted last on the roster. A coach's own call, never by name. */
export async function setTestAccountAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const id = str(formData, "membershipId");
  const cm = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, id), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!cm || cm.role !== "client") redirect("/coach");
  const on = str(formData, "testAccount") === "on";
  await db.update(schema.memberships).set({ testAccount: on }).where(eq(schema.memberships.id, cm!.id));
  redirect(`/coach/${cm!.id}?test=${on ? "on" : "off"}`);
}

/** Back to the coach's own account, from any page while switched. Logged on the coach's record of switches. */
export async function switchBackAction(): Promise<void> {
  const session = await readSession();
  if (!session?.sw) redirect("/today");
  const v = await getViewer();
  if (v?.switchedInto) await logSwitch({ workspaceId: v.workspace.id, clientMembershipId: v.switchedInto.membershipId, userId: v.user.id, coachUserId: v.actor.id, kind: "switch_out", mode: v.switchedInto.mode });
  await writeSession({ userId: session!.userId, workspaceId: session!.workspaceId, role: session!.role, sv: session!.sv });
  redirect(`/coach/${session!.sw!.m}`);
}

/**
 * "Let my coach work in my HelixOS" (rev 216), the client's own choice, in their Settings. Off, a coach switched in can only
 * look, at once. Never changed by a coach acting as the client.
 */
export async function setCoachCanWorkAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own consent to give, so it can't be changed from their HelixOS." });
  const on = str(formData, "coachCanWork") === "on";
  if (v.membership.coachCanWork !== on) {
    await db.update(schema.memberships).set({ coachCanWork: on }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
    await logSync({ workspaceId: v.workspace.id, userId: v.user.id, provider: "account", direction: "in", event: on ? "coach_work.on" : "coach_work.off", payload: { at: nowIso() }, status: "sent", note: `Let my coach work in my HelixOS: ${on ? "on" : "off"}` });
  }
  redirect(`/settings?tab=data&coachWork=${on ? "on" : "off"}#your-coach`);
}
