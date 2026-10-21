"use server";

/**
 * The buttons on Claude's drafts everywhere (H-184): Approve writes a draft through, Discard drops it, Undo puts back what a
 * change replaced (seven days). Edit is a link: the area's own form, filled with the draft, saved by the area's own save. The
 * member approves in their own HelixOS; a coach working in a client's approves for them, logged as the coach.
 */
import { redirect } from "next/navigation";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { approveDraft, discardDraft, startFromNewDraft, undoChange } from "@/lib/claude-drafts";

/** Back where the button was: the app's own paths only, with what happened. A new row approved goes to its own page ("open"). */
function back(formData: FormData, note: string, targetId?: string | null): string {
  const safe = (p: string) => (p.startsWith("/") && !p.startsWith("//") ? p : "");
  const open = safe(str(formData, "open"));
  const to = targetId && open ? `${open.replace(/\/$/, "")}/${targetId}` : safe(str(formData, "back")) || "/drafts";
  const [path, hash] = to.split("#");
  return `${path}${path!.includes("?") ? "&" : "?"}draftNote=${encodeURIComponent(note)}${hash ? `#${hash}` : ""}`;
}

export async function approveClaudeDraftAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const r = await approveDraft({ workspaceId, userId }, str(formData, "draftId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(formData, r.ok ? "approved" : r.why, r.ok ? r.targetId : null));
}

/** Edit on a draft of a new offer, magnet or post: it's made with its name, and its page opens with the draft in the form. */
export async function editNewClaudeDraftAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const draftId = str(formData, "draftId");
  const r = await startFromNewDraft({ workspaceId, userId }, draftId);
  refresh();
  const page = r.ok ? ({ offer: `/offers/${r.targetId}?draft=${draftId}#who`, magnet: `/magnets/${r.targetId}?draft=${draftId}`, content: `/content/${r.targetId}?draft=${draftId}` } as Record<string, string>)[r.area] : null;
  redirect(page ?? back(formData, r.ok ? "That draft opens on its own page." : r.why));
}

export async function discardClaudeDraftAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const r = await discardDraft({ workspaceId, userId }, str(formData, "draftId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(formData, r.ok ? "discarded" : r.why));
}

export async function undoClaudeChangeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const r = await undoChange({ workspaceId, userId }, str(formData, "historyId"), { name: v.actor.name, connector: false });
  refresh();
  redirect(back(formData, r.ok ? "undone" : r.why));
}
