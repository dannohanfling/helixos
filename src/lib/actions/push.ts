"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db, schema } from "@/db";
import { ctx, num, refresh } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { PUSH_TYPES } from "@/lib/engine/push";
import { ensurePrefs } from "@/lib/push/prefs";
import { countPushPhones, sendTestPush } from "@/lib/push/send";
import { startTestSeries, stopTestSeries } from "@/lib/push/test-series";

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

/** Seconds between the tap and the push, so the member can close the app and watch it land (H-1987). */
const TEST_PUSH_DELAY_SECONDS = 5;

export async function sendTestPushAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the member can send themselves a test.", team: "refuse" });
  const phones = await countPushPhones(v.membership.id);
  if (!phones) redirect("/settings/notifications?test=none");
  const membershipId = v.membership.id;
  // After the answer: the page says "close the app now", and the push follows a few seconds later.
  after(async () => {
    await new Promise((r) => setTimeout(r, TEST_PUSH_DELAY_SECONDS * 1000));
    await sendTestPush(membershipId).catch(() => undefined);
  });
  redirect("/settings/notifications?test=soon");
}

/** A coach's test series (H-1967, Approve H-1968): ten pushes to their own phones, 3 minutes apart. Coaches only, as themselves. */
export async function startTestSeriesAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the coach can send themselves a test series.", team: "refuse" });
  if (v.membership.role !== "coach") redirect("/settings/notifications");
  await startTestSeries({ id: v.membership.id, userId: v.user.id });
  redirect("/settings/notifications?series=on");
}

export async function stopTestSeriesAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Only the coach can stop their own test series.", team: "refuse" });
  await stopTestSeries(v.membership.id);
  redirect("/settings/notifications?series=stopped");
}
