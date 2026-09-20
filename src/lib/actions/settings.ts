"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { inviteCode } from "@/lib/ids";
import { redirect } from "next/navigation";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { brandKitProblems, normaliseHex } from "@/lib/engine/subject";
import { syncFieldTasks } from "@/lib/queries/pathway";

/** Any IANA zone the runtime knows; anything else is null, meaning "use the workspace's". */
function validTimezone(tz: string): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  await updateProfile(formData);
  const { workspaceId, userId } = await ctx();
  await syncFieldTasks(workspaceId, userId);
  refresh();
}

async function updateProfile(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const name = str(formData, "name");
  const emoji = str(formData, "avatarEmoji");
  await db.update(schema.users).set({ ...(name ? { name } : {}), ...(emoji ? { avatarEmoji: emoji.slice(0, 4) } : {}) }).where(eq(schema.users.id, userId));
  await db
    .update(schema.memberships)
    .set({
      businessName: opt(formData, "businessName"),
      bigPromise: opt(formData, "bigPromise"),
      audience: opt(formData, "audience"),
      reminderHour: Math.min(23, Math.max(0, num(formData, "reminderHour") || 8)),
      eveningReminderHour: Math.min(23, Math.max(0, num(formData, "eveningReminderHour") || 17)),
      leaderboardOptIn: formData.get("leaderboardOptIn") === "on",
      timezone: validTimezone(str(formData, "timezone")),
    })
    .where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

export async function updateGoalAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const title = str(formData, "title") || "Cash collected this month";
  const target = num(formData, "target") || 5000;
  const existing = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) });
  if (existing) {
    await db.update(schema.goals).set({ title, target, actual: num(formData, "actual"), unit: str(formData, "unit") || "$", period: str(formData, "period") || "This month" }).where(eq(schema.goals.id, existing.id));
  } else {
    await db.insert(schema.goals).values({ id: newId(), workspaceId, userId, title, target, actual: num(formData, "actual"), unit: str(formData, "unit") || "$", period: str(formData, "period") || "This month", primary: true });
  }
  await syncFieldTasks(workspaceId, userId);
  refresh();
}

export async function updateWorkspaceAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  await db
    .update(schema.workspaces)
    .set({
      name: str(formData, "name") || coach.workspace.name,
      timezone: str(formData, "timezone") || coach.workspace.timezone,
      airtableBaseId: opt(formData, "airtableBaseId"),
    })
    .where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}

export async function rotateInviteAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const which = str(formData, "which") === "coach" ? "coachInviteCode" : "clientInviteCode";
  await db.update(schema.workspaces).set({ [which]: inviteCode() }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
}

/** The workspace's brand kit: refused with each problem named when a pair cannot read on a slide or a colour is one the brand bans. */
export async function saveBrandKitAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const kit = {
    name: str(formData, "name"),
    ground: normaliseHex(str(formData, "ground")),
    ink: normaliseHex(str(formData, "ink")),
    accent: normaliseHex(str(formData, "accent")),
    muted: normaliseHex(str(formData, "muted")),
    surface: normaliseHex(str(formData, "surface")),
    inverseGround: normaliseHex(str(formData, "inverseGround")) || null,
    inverseInk: normaliseHex(str(formData, "inverseInk")) || null,
    displayFont: str(formData, "displayFont"),
    bodyFont: str(formData, "bodyFont"),
    quoteFont: opt(formData, "quoteFont"),
    fontFallback: str(formData, "fontFallback") || "Arial",
    bannedColors: str(formData, "bannedColors").split(/[,\s]+/).map(normaliseHex).filter(Boolean),
    placeholder: normaliseHex(str(formData, "placeholder")) || null,
    // Permitted names: a script may introduce one with no warning; none is ever reported as the presenter.
    aliases: str(formData, "aliases").split(/[,\n]+/).map((a) => a.trim()).filter(Boolean),
    notes: opt(formData, "notes"),
  };
  const problems = brandKitProblems(kit);
  // Refused with the problems named, and what was typed comes back with it: a refusal never empties the form.
  if (problems.length) redirect(`/settings?brand=${encodeURIComponent(problems.join(" "))}&draft=${encodeURIComponent(JSON.stringify(kit))}#brand-kit`);
  const existing = await db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, coach.workspace.id) });
  if (existing) await db.update(schema.brandKits).set(kit).where(eq(schema.brandKits.id, existing.id));
  else await db.insert(schema.brandKits).values({ id: newId(), workspaceId: coach.workspace.id, ...kit });
  refresh();
  redirect("/settings?brand=saved#brand-kit");
}
