"use server";

/**
 * On the horizon (H-385): a member's Want this and the one-time "it shipped" notice; the coach's add, edit, hide, move and
 * reorder. A switched coach never votes as the member; a team member never votes for the owner.
 */
import { redirect } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { isStatus, parseHorizonForm } from "@/lib/engine/horizon";
import { addHorizonItem, dismissShippedNotice, moveHorizonItem, reorderHorizonItem, saveHorizonItem, setHorizonHidden, toggleWant } from "@/lib/horizon";

export async function toggleWantAction(itemId: string): Promise<{ wanted: boolean } | { error: string }> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Want this is {first}'s own vote." });
  const out = await toggleWant(v, String(itemId));
  refresh();
  return out;
}

/** The notice was read: a switched coach never dismisses it for the member. */
export async function dismissShippedNoticeAction(itemId: string): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  await dismissShippedNotice(v, String(itemId));
}

const fields = (fd: FormData) => parseHorizonForm({ title: str(fd, "title"), line: str(fd, "line"), area: str(fd, "area"), status: str(fd, "status"), fromFeedback: fd.get("fromFeedback") === "on", menuKey: str(fd, "menuKey") });
const back = (q: string): never => redirect(`/coach/horizon?${q}`);

export async function addHorizonItemAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const f = fields(formData);
  if (!f.ok) return back(`error=${encodeURIComponent(f.error)}#add`);
  const id = await addHorizonItem(coach.workspace.id, f.item);
  refresh();
  back(`saved=1#h-${id}`);
}

export async function saveHorizonItemAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  const f = fields(formData);
  if (!f.ok) return back(`error=${encodeURIComponent(f.error)}#h-${id}`);
  await saveHorizonItem(coach.workspace.id, id, f.item);
  refresh();
  back(`saved=1#h-${id}`);
}

export async function setHorizonHiddenAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  await setHorizonHidden(coach.workspace.id, id, str(formData, "hidden") === "1");
  refresh();
  back(`saved=1#h-${id}`);
}

export async function moveHorizonItemAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  const status = str(formData, "status");
  if (isStatus(status)) await moveHorizonItem(coach.workspace.id, id, status);
  refresh();
  back(`saved=1#h-${id}`);
}

export async function reorderHorizonItemAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(formData, "id");
  await reorderHorizonItem(coach.workspace.id, id, str(formData, "dir") === "up" ? "up" : "down");
  refresh();
  back(`#h-${id}`);
}
