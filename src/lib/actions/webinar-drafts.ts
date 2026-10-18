"use server";

/**
 * The wizard's buttons for Claude's drafts (H-181): Approve writes a draft through, Discard drops it, Undo puts back what a
 * change replaced (seven days). Edit is a link: the step's own form, filled with the draft, saved by the step's own save.
 */
import { redirect } from "next/navigation";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { approveDraft, discardDraft, ownWebinar, undoHistory } from "@/lib/webinar-drafts";

const back = (id: string, step: string, note: string) => `/webinars/${id}?step=${encodeURIComponent(step)}${note ? `&draftNote=${encodeURIComponent(note)}` : ""}`;

export async function approveWebinarDraftAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const webinarId = str(formData, "webinarId");
  const step = str(formData, "step") || "foundation";
  if (!(await ownWebinar({ workspaceId, userId }, webinarId))) redirect("/webinars");
  const r = await approveDraft({ workspaceId, userId, name: v.user.name }, str(formData, "draftId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(webinarId, step, r.ok ? "approved" : r.why));
}

export async function discardWebinarDraftAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const webinarId = str(formData, "webinarId");
  const step = str(formData, "step") || "foundation";
  if (!(await ownWebinar({ workspaceId, userId }, webinarId))) redirect("/webinars");
  const r = await discardDraft({ workspaceId, userId }, str(formData, "draftId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(webinarId, step, r.ok ? "discarded" : r.why));
}

export async function undoWebinarChangeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const webinarId = str(formData, "webinarId");
  const step = str(formData, "step") || "foundation";
  if (!(await ownWebinar({ workspaceId, userId }, webinarId))) redirect("/webinars");
  const r = await undoHistory({ workspaceId, userId }, str(formData, "historyId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(webinarId, step, r.ok ? "undone" : r.why));
}
