"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { OOH_LOCKED_LINE, OOH_OUTCOMES, readList } from "@/lib/engine/office-hours";
import { oohAccessFor } from "@/lib/office-hours-access";
import { saveOohRequest } from "@/lib/office-hours-core";
import { teamOf } from "@/lib/team";

/** Opening Office Hours clears the owner's "booked for you" line (H-413). A team member or a switched coach never clears it. */
export async function clearOohNoticeAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop", team: "noop" });
  if (v.switchedInto || v.team || !v.membership.oohNotice) return;
  await db.update(schema.memberships).set({ oohNotice: null }).where(eq(schema.memberships.id, v.membership.id));
}

/**
 * A member's Open Office Hours request, new or edited (handoff rev 124). The two gates come first, as on the old form. The
 * month, the member and their email come from the date and the login, never the form. A request can be changed up to and
 * including its Friday; the coach's fields (who takes it, how it went, notes) are never the member's to write.
 */
export async function saveOohRequestAction(formData: FormData): Promise<void> {
  // Team access (H-413): a team member books for the owner; the request is the owner's, with the team member as its submitter.
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's in {first}'s own words, so it's theirs to write.", team: "allow" });
  // Office Hours by program level (H-470): enforced here, not only in the menu; the team path answers for its owner.
  if (!(await oohAccessFor(v)).open) redirect(`/office-hours?error=${encodeURIComponent(OOH_LOCKED_LINE)}#mine`);
  const team = await teamOf(v.membership.id);
  const saved = await saveOohRequest(
    { workspaceId, userId, today: v.today, categories: v.workspace.oohCategories, actorId: v.team ? v.actor.id : null, attendeesAllowed: team.map((t) => t.member.teamUserId) },
    {
      attendees: formData.getAll("attendees").map(String),
      attendeesOther: str(formData, "attendeesOther"),
      friday: str(formData, "friday"),
      description: str(formData, "description"),
      triedSelf: str(formData, "triedSelf"),
      tools: str(formData, "tools"),
      goal: str(formData, "goal"),
      category: str(formData, "category"),
      triedGate: str(formData, "triedGate"),
      promise: formData.get("promise") === "yes",
    },
    str(formData, "requestId") || null,
  );
  if (!saved.ok && "goBack" in saved) redirect(`/office-hours?back=1#request`);
  if (!saved.ok && saved.field === "edit") redirect(`/office-hours?error=${encodeURIComponent(saved.error)}#mine`);
  if (!saved.ok) redirect(`/office-hours?error=${encodeURIComponent(saved.error)}${saved.field ? `&field=${saved.field}` : ""}#request`);
  // The owner's notice (H-413): a new request a team member booked for them, until they open Office Hours. Push comes later.
  if (v.team && !saved.edited) await db.update(schema.memberships).set({ oohNotice: { teamUserId: v.actor.id, friday: saved.value.friday, requestId: saved.id, at: nowIso() } }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`/office-hours?saved=1#mine`);
}

/** The coach's side of one request: who takes it (from the workspace's list), covered or no-show, and notes. */
export async function updateOohRequestAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const workspaceId = coach.workspace.id;
  const responsible = str(formData, "responsible");
  const outcome = OOH_OUTCOMES.find((o) => o === str(formData, "outcome")) ?? null;
  await db
    .update(schema.officeHoursRequests)
    .set({ responsible: coach.workspace.oohHosts.includes(responsible) ? responsible : null, outcome, coachNotes: str(formData, "coachNotes") || null, updatedAt: nowIso() })
    .where(and(eq(schema.officeHoursRequests.id, str(formData, "requestId")), eq(schema.officeHoursRequests.workspaceId, workspaceId)));
  refresh();
  redirect(`/coach/office-hours?updated=1#r-${str(formData, "requestId")}`);
}

/** The coach edits the category list members pick from and the list of who can be responsible, one per line. */
export async function setOohListsAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const categories = readList(str(formData, "categories"));
  const hosts = readList(str(formData, "hosts"));
  if (!categories.length) redirect(`/coach/office-hours?error=${encodeURIComponent("Keep at least one category.")}#lists`);
  // The call's time and link (friction walk OH1, 7 Oct): members read them on Office Hours. The link is a web address or nothing.
  const oohTime = str(formData, "time").trim().slice(0, 120) || null;
  const oohLink = str(formData, "link").trim() || null;
  if (oohLink && !/^https:\/\/\S+$/.test(oohLink)) redirect(`/coach/office-hours?error=${encodeURIComponent("The join link starts with https://.")}#lists`);
  await db.update(schema.workspaces).set({ oohCategories: categories, oohHosts: hosts, oohTime, oohLink }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
  redirect(`/coach/office-hours?lists=1#lists`);
}
