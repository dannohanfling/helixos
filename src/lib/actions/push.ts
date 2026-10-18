"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, num, refresh } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { PUSH_TYPES } from "@/lib/engine/push";
import { ensurePrefs } from "@/lib/push/prefs";
import { sendTestPush } from "@/lib/push/send";

const hour = (n: number, fallback: number) => (Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback);

/** Settings → Notifications (H-767): the main switch, each type, the two times and quiet hours. The member's own only. */
export async function savePushPrefsAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the member sets their own notifications.", team: "refuse" });
  const row = await ensurePrefs({ id: v.membership.id, workspaceId: v.workspace.id, userId: v.user.id });
  // Only the kinds already built are on the form; a Coming soon one keeps whatever it was (its box is disabled, so not sent).
  const types: Record<string, boolean> = { ...(row.types ?? {}) };
  for (const t of PUSH_TYPES.filter((x) => x.ready)) {
    const on = formData.get(`type_${t.type}`) === "on";
    if (on !== t.defaultOn) types[t.type] = on;
    else delete types[t.type];
  }
  await db
    .update(schema.pushPrefs)
    .set({
      enabled: formData.get("enabled") === "on",
      types,
      quietStart: hour(num(formData, "quietStart"), 21),
      quietEnd: hour(num(formData, "quietEnd"), 7),
      updatedAt: nowIso(),
    })
    .where(eq(schema.pushPrefs.id, row.id));
  await db
    .update(schema.memberships)
    .set({ reminderHour: hour(num(formData, "reminderHour"), v.membership.reminderHour), eveningReminderHour: hour(num(formData, "eveningReminderHour"), v.membership.eveningReminderHour) })
    .where(eq(schema.memberships.id, v.membership.id));
  refresh();
  redirect("/settings/notifications?saved=1");
}

export async function sendTestPushAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the member can send themselves a test.", team: "refuse" });
  const r = await sendTestPush(v.membership.id);
  redirect(`/settings/notifications?test=${r.delivered > 0 ? "sent" : r.phones > 0 ? "failed" : "none"}`);
}
