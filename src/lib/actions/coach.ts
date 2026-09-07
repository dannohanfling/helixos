"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { sendEmail } from "@/lib/email";
import { comebackEmail } from "@/lib/reminders";
import { nowIso, todayInTz } from "@/lib/dates";

export async function setClientPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const enabled = str(formData, "enabled") === "1";
  const tier = str(formData, "programTier");
  await db
    .update(schema.memberships)
    .set({ passEnabled: enabled, ...(tier ? { programTier: tier } : {}) })
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}

/** Sends the comeback email to one quiet client right now, at most once a day. The nudge is logged on the membership. */
export async function nudgeMemberAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) return;
  if (m.lastNudgedAt && Date.now() - new Date(m.lastNudgedAt).getTime() < 20 * 3600_000) return;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  if (!user) return;
  const today = todayInTz(m.timezone || coach.workspace.timezone);
  const c = comebackEmail(user.name.split(" ")[0], today, process.env.APP_URL ?? "http://localhost:3000");
  try {
    await sendEmail(user.email, c.subject, c.text);
    await db.update(schema.memberships).set({ lastNudgedAt: nowIso(), lastComebackAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  } catch (e) {
    console.error(`[coach] nudge to ${m.userId} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  refresh();
}
