"use server";

import { setTarget } from "@/lib/targets-core";
import { TARGET_METRICS } from "@/lib/engine/targets";
import { ctx, money, num, refresh, str } from "@/lib/action-helpers";

/** Saves the month's targets. Zero clears a target. */
export async function setTargetsAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const month = str(formData, "month");
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  for (const m of TARGET_METRICS) {
    // Cash the way people write it (rev 444): "20k" is 20000, never 20; one that can't be read is refused beside its box.
    const target = m.money ? (money(formData, m.key, (e) => `/numbers?targetsError=${encodeURIComponent(e)}&field=${m.key}`) ?? 0) : num(formData, m.key);
    await setTarget({ workspaceId, userId }, month, m.key, target);
  }
  refresh();
}
