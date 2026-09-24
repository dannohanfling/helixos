"use server";

import { redirect } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { deletedTo } from "@/lib/deleted";
import { EraseStopped, eraseMember, planErase } from "@/lib/erase";
import { refresh, str } from "@/lib/action-helpers";

/**
 * Deletion on request, from /coach/[clientId]/delete. The coach (never a client), never their own account, and only once the
 * member's email is typed back exactly. The plan is made again here, so what runs is what the database holds now. A refused
 * store delete comes back beside the button, naming the object; nothing after it was removed.
 */
export async function eraseMemberAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const back = `/coach/${membershipId}/delete`;
  const plan = await planErase(coach.workspace.id, membershipId);
  if (!plan) redirect("/coach");
  if (plan.userId === coach.user.id) redirect(`${back}?error=${encodeURIComponent("You can't delete your own account from here.")}`);
  if (str(formData, "email").trim().toLowerCase() !== plan.email.trim().toLowerCase()) redirect(`${back}?error=${encodeURIComponent("Nothing was deleted: the email typed does not match theirs.")}`);
  try {
    await eraseMember(plan, coach.user.id);
  } catch (e) {
    if (e instanceof EraseStopped) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  refresh();
  redirect(deletedTo("/coach", "member"));
}
