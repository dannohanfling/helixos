"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { STORY_STATUSES, type StoryStatus } from "@/lib/engine/teaching";

/** Danno sets a story's status (rev 618): ready, check, or needs permission. His own items only; it stands over a re-upload. */
export async function setStoryStatusAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) redirect("/coach/teaching");
  const status = str(formData, "status") as StoryStatus;
  if (!(STORY_STATUSES as readonly string[]).includes(status)) redirect("/coach/teaching");
  await db.update(schema.storyItems).set({ status, statusSetBy: v.user.id, updatedAt: nowIso() }).where(and(eq(schema.storyItems.id, str(formData, "id")), eq(schema.storyItems.userId, v.user.id)));
  refresh();
  const back = str(formData, "back");
  redirect(`${back.startsWith("/coach/teaching") ? back : "/coach/teaching"}${back.includes("?") ? "&" : "?"}saved=1#stories`);
}
