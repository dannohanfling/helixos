"use server";

import { redirect } from "next/navigation";
import { clearSession } from "@/lib/session";
import { EraseStopped, eraseBody, eraseMember, planBodyErase, planErase } from "@/lib/erase";
import { ctx, refresh, str } from "@/lib/action-helpers";

/**
 * H-331: the two deletions a member runs alone, from Settings → Account. Each asks for the member's own email typed back, makes
 * its plan again on the server (so what runs is what the database holds now), and refuses while a coach is switched into the
 * member or a team member is acting for them. A coach's own account runs the workspace, so it never goes this way: the
 * page says so and points at Support.
 */
export async function eraseMyBodyAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the member can delete their own HumanOS data.", team: "refuse" });
  const back = "/settings/delete-humanos";
  if (str(formData, "email").trim().toLowerCase() !== v.user.email.trim().toLowerCase()) redirect(`${back}?error=${encodeURIComponent("Nothing was deleted: the email typed does not match yours.")}`);
  const plan = await planBodyErase(v.workspace.id, v.user.id);
  if (!plan) redirect("/settings");
  await eraseBody(plan, v.actor.id);
  refresh();
  redirect("/settings?humanos=deleted#humanos");
}

export async function eraseMyAccountAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the member can delete their own account.", team: "refuse" });
  const back = "/settings/delete-account";
  if (v.role === "coach") redirect(`${back}?error=${encodeURIComponent("Your account runs this HelixOS, so it can't be deleted from here. Write to us from the Support page.")}`);
  if (str(formData, "email").trim().toLowerCase() !== v.user.email.trim().toLowerCase()) redirect(`${back}?error=${encodeURIComponent("Nothing was deleted: the email typed does not match yours.")}`);
  const plan = await planErase(v.workspace.id, v.membership.id);
  if (!plan || plan.userId !== v.user.id) redirect("/settings");
  try {
    await eraseMember(plan, v.user.id);
  } catch (e) {
    if (e instanceof EraseStopped) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await clearSession();
  redirect("/login?reason=account-deleted");
}
