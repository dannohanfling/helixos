"use server";

import { readMoney } from "@/lib/engine/money";
import { queueProgress } from "@/lib/chat-progress";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { inviteCode } from "@/lib/ids";
import { redirect } from "next/navigation";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { brandKitProblems, normaliseHex } from "@/lib/engine/subject";
import { syncFieldTasks } from "@/lib/queries/pathway";
import { syncPrimaryKpi } from "@/lib/queries/kpi";

/** A picked logo's id when it is one of this member's own images of kind logo; otherwise null, so the kit keeps no logo. */
async function ownLogo(workspaceId: string, userId: string, picked: string): Promise<string | null> {
  const id = picked.trim();
  if (!id) return null;
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId), eq(schema.deckImages.kind, "logo")) });
  return img ? img.id : null;
}
/** The graphic's avatar (rev 513): one of the member's own photos or logos, never another member's. */
async function ownAvatar(workspaceId: string, userId: string, picked: string): Promise<string | null> {
  const id = picked.trim();
  if (!id) return null;
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId)) });
  return img && (img.kind === "photo" || img.kind === "logo") ? img.id : null;
}

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
  // Refused before anything is written: a coach switched in never changes the client's own account.
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "{first}'s name, email, password and time zone are their own account settings." });
  await updateProfile(formData);
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

/**
 * What the bot says about the business, the coach's own and not any offer's (rev 80): What I do, the three questions (blank means
 * the house question) and the guarantee's structured terms. Nothing is pushed from here; Your bot shows what would change.
 */
export async function updateBotFactsAction(formData: FormData): Promise<void> {
  const { userId, workspaceId } = await ctx();
  const n = (key: string): number | undefined => (str(formData, key) ? num(formData, key) : undefined);
  const conditions = str(formData, "termsConditions").split("\n").map((l) => l.trim()).filter(Boolean);
  await db
    .update(schema.memberships)
    .set({
      whatIDo: opt(formData, "whatIDo"),
      botQuestion1: opt(formData, "botQuestion1"),
      botQuestion2: opt(formData, "botQuestion2"),
      botQuestion3: opt(formData, "botQuestion3"),
      guaranteeTermsUrl: opt(formData, "guaranteeTermsUrl"),
      guaranteeTerms: { windowMonths: n("termsWindowMonths"), attendancePct: n("termsAttendancePct"), replayDays: n("termsReplayDays"), measure: opt(formData, "termsMeasure") ?? undefined, conditions: conditions.length ? conditions : undefined, exclusions: opt(formData, "termsExclusions") ?? undefined, remedy: opt(formData, "termsRemedy") ?? undefined },
    })
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
}

export async function updateGoalAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const title = str(formData, "title") || "Cash collected this month";
  // Amounts the way people write them (rev 444): "5k" is 5000, never 5; one that can't be read is refused beside its box.
  const t = readMoney(str(formData, "target"));
  if ("error" in t) redirect(`/settings?goalError=${encodeURIComponent(t.error)}&field=target#goal`);
  const a = readMoney(str(formData, "actual"));
  if ("error" in a) redirect(`/settings?goalError=${encodeURIComponent(a.error)}&field=actual#goal`);
  const target = t.value || 5000;
  const actual = a.value ?? 0;
  const existing = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) });
  const unit = str(formData, "unit") || "$";
  const period = str(formData, "period") || "This month";
  const id = existing?.id ?? newId();
  if (existing) {
    await db.update(schema.goals).set({ title, target, actual, unit, period }).where(eq(schema.goals.id, existing.id));
  } else {
    await db.insert(schema.goals).values({ id, workspaceId, userId, title, target, actual, unit, period, primary: true });
  }
  // The Primary business goal and its KPI follow (BG2): the title, the target, the unit and the period; "So far" for a typed KPI.
  await syncPrimaryKpi({ workspaceId, userId }, { id, title, target, actual, unit, period }, v.today);
  await syncFieldTasks(workspaceId, userId);
  queueProgress(workspaceId, userId, "goal_changed");
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

/** Back to the house starter kit (first-deck brief §1): the member's own kit goes; their decks use the starter until a new one is saved. */
export async function resetBrandKitAction(): Promise<void> {
  // The member's own kit (rev 568); a coach switched in with Work on resets it for them, and that is logged like any other change.
  const { workspaceId, userId } = await ctx();
  await db.delete(schema.brandKits).where(and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)));
  refresh();
  redirect("/settings?brand=reset#brand-kit");
}

/**
 * The member's own brand kit (rev 568: one per member, every member sees the card): refused with each problem named when a
 * pair cannot read on a slide or a colour is one the brand bans. A coach switched in with Work on saves it for the client,
 * logged; in View it is refused like every write.
 */
export async function saveBrandKitAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
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
    // The logo (deck visuals §4): one of the member's own library images of kind logo, or none. Another member's image, even
    // in the same workspace, is never accepted (rev 568, the rule of 6cbb890).
    logoImageId: await ownLogo(workspaceId, userId, str(formData, "logoImageId")),
    // The dark-ground logo (first-deck brief §3): the same rule.
    logoDarkImageId: await ownLogo(workspaceId, userId, str(formData, "logoDarkImageId")),
    bannedColors: str(formData, "bannedColors").split(/[,\s]+/).map(normaliseHex).filter(Boolean),
    placeholder: normaliseHex(str(formData, "placeholder")) || null,
    // Permitted names: a script may introduce one with no warning; none is ever reported as the presenter.
    aliases: str(formData, "aliases").split(/[,\n]+/).map((a) => a.trim()).filter(Boolean),
    showPriceAnchor: str(formData, "showPriceAnchor") === "1",
    notes: opt(formData, "notes"),
    // Make the graphic's badge and gold (rev 513), and the AI backgrounds switch (rev 524), on the same kit: one Brand section.
    graphicDisplayName: opt(formData, "graphicDisplayName")?.trim().slice(0, 80) || null,
    graphicHandle: (opt(formData, "graphicHandle")?.trim() ? `@${opt(formData, "graphicHandle")!.trim().replace(/^@/, "")}`.slice(0, 60) : null),
    graphicVerified: str(formData, "graphicVerified") === "1",
    graphicAvatarImageId: await ownAvatar(workspaceId, userId, str(formData, "graphicAvatarImageId")),
    graphicGoldFrom: normaliseHex(str(formData, "graphicGoldFrom")) || null,
    graphicGoldTo: normaliseHex(str(formData, "graphicGoldTo")) || null,
    aiBackgrounds: str(formData, "aiBackgrounds") === "1",
  };
  const problems = brandKitProblems(kit);
  // Refused with the problems named, and what was typed comes back with it: a refusal never empties the form.
  if (problems.length) redirect(`/settings?brand=${encodeURIComponent(problems.join(" "))}&draft=${encodeURIComponent(JSON.stringify(kit))}#brand-kit`);
  const existing = await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)) });
  if (existing) await db.update(schema.brandKits).set(kit).where(eq(schema.brandKits.id, existing.id));
  else await db.insert(schema.brandKits).values({ id: newId(), workspaceId, userId, ...kit });
  refresh();
  redirect("/settings?brand=saved#brand-kit");
}
