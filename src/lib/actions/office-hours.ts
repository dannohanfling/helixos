"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { OOH_OUTCOMES, oohEditable, readList, readOohRequest } from "@/lib/engine/office-hours";

/**
 * A member's Open Office Hours request, new or edited (handoff rev 124). The two gates come first, as on the old form. The
 * month, the member and their email come from the date and the login, never the form. A request can be changed up to and
 * including its Friday; the coach's fields (who takes it, how it went, notes) are never the member's to write.
 */
export async function saveOohRequestAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const read = readOohRequest(
    {
      friday: str(formData, "friday"),
      description: str(formData, "description"),
      triedSelf: str(formData, "triedSelf"),
      tools: str(formData, "tools"),
      goal: str(formData, "goal"),
      category: str(formData, "category"),
      triedGate: str(formData, "triedGate"),
      promise: formData.get("promise") === "yes",
    },
    v.today,
    v.workspace.oohCategories,
  );
  if ("goBack" in read) redirect(`/office-hours?back=1#request`);
  if ("error" in read) redirect(`/office-hours?error=${encodeURIComponent(read.error)}#request`);
  const { value } = read;
  const requestId = str(formData, "requestId");
  if (requestId) {
    const existing = await db.query.officeHoursRequests.findFirst({ where: and(eq(schema.officeHoursRequests.id, requestId), eq(schema.officeHoursRequests.userId, userId), eq(schema.officeHoursRequests.workspaceId, workspaceId)) });
    if (!existing || !oohEditable(v.today, existing.friday)) redirect(`/office-hours?error=${encodeURIComponent("That request can't be changed after its Friday.")}#mine`);
    await db
      .update(schema.officeHoursRequests)
      .set({ friday: value.friday, description: value.description, triedSelf: value.triedSelf, tools: value.tools || null, goal: value.goal, category: value.category, updatedAt: nowIso() })
      .where(and(eq(schema.officeHoursRequests.id, existing.id), eq(schema.officeHoursRequests.userId, userId), eq(schema.officeHoursRequests.workspaceId, workspaceId)));
  } else {
    await db.insert(schema.officeHoursRequests).values({ id: newId(), workspaceId, userId, friday: value.friday, description: value.description, triedSelf: value.triedSelf, tools: value.tools || null, goal: value.goal, category: value.category });
  }
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
  await db.update(schema.workspaces).set({ oohCategories: categories, oohHosts: hosts }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
  redirect(`/coach/office-hours?lists=1#lists`);
}
