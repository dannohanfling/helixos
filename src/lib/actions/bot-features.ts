"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { BEHAVIORS, BOT_FEATURE_KEYS, featureOf, readRule, readSetup, type Behavior, type BotFeatureKey } from "@/lib/engine/bot-features";
import { TIERS } from "@/lib/engine/tiers";
import { featuresFor } from "@/lib/bot-features";
import { appUrl, brandedEmail } from "@/lib/branded-email";
import { canEmail } from "@/lib/email-gate";
import { sendEmail } from "@/lib/email";

const back = (key: string, q: string) => redirect(`/bot-features/${key}?${q}`);

/**
 * "Turn it on for me" (rev 618): the client's setup, read and checked here, then one request in the coach's queue. Only an
 * unlocked feature can be asked for, never a Coming soon one, and asking again while it waits or runs changes nothing. Team
 * members see Bot Features but can't ask; a coach switched into a client can't ask for them either.
 */
export async function requestFeatureAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", team: "refuse", reason: "Turning on {first}'s bot features is theirs to ask for." });
  const key = str(formData, "key");
  const feature = featureOf(key);
  if (!feature) redirect("/bot-features");
  const view = (await featuresFor(v.membership)).find((x) => x.feature.key === feature.key)!;
  if (view.state !== "unlocked") back(feature.key, view.state === "locked" ? "error=locked" : "sent=1");
  const raw = Object.fromEntries(feature.setup.map((s) => [s.key, str(formData, s.key)]));
  const read = readSetup(feature, raw);
  if ("error" in read) back(feature.key, new URLSearchParams({ error: read.error, field: read.field, ...Object.fromEntries(Object.entries(raw).map(([k, x]) => [`v_${k}`, x.slice(0, 500)])) }).toString());
  const setup = "value" in read ? read.value : {};
  await db
    .insert(schema.botFeatureRequests)
    .values({ id: newId(), workspaceId, userId, featureKey: feature.key, state: "requested", setup, requestedAt: nowIso() })
    .onConflictDoUpdate({ target: [schema.botFeatureRequests.workspaceId, schema.botFeatureRequests.userId, schema.botFeatureRequests.featureKey], set: { state: "requested", setup, requestedAt: nowIso(), onAt: null, onBy: null } });
  refresh();
  back(feature.key, "sent=1");
}

/**
 * The coach has switched the feature on in the client's bot (by hand, in their Community Loyalty workspace): the card turns On,
 * the client's Today says so, and they get one email. "Not on yet" puts it back in the queue without an email.
 */
export async function setFeatureOnAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const on = str(formData, "on") === "1";
  const req = await db.query.botFeatureRequests.findFirst({ where: and(eq(schema.botFeatureRequests.id, str(formData, "id")), eq(schema.botFeatureRequests.workspaceId, coach.workspace.id)) });
  if (!req) return;
  if (!on) {
    await db.update(schema.botFeatureRequests).set({ state: "requested", onAt: null, onBy: null }).where(eq(schema.botFeatureRequests.id, req.id));
    refresh();
    return;
  }
  if (req.state === "on") return;
  await db.update(schema.botFeatureRequests).set({ state: "on", onAt: nowIso(), onBy: coach.user.id }).where(eq(schema.botFeatureRequests.id, req.id));
  const feature = featureOf(req.featureKey)!;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, coach.workspace.id), eq(schema.memberships.userId, req.userId)) });
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, req.userId) });
  if (m && u && (await canEmail(m.id))) {
    const mail = brandedEmail(
      {
        subject: `${feature.name} is on in your bot`,
        preheader: `${feature.name} is running in your bot now.`,
        greeting: `Hi ${u.name.split(" ")[0]},`,
        stateLine: null,
        asks: [`${feature.name} is on and running in your bot. ${feature.shortLine}`, ...(feature.ghl ? [`In GoHighLevel, build your ${feature.ghl.build} on the tag${feature.ghl.tags.length > 1 ? "s" : ""} ${feature.ghl.tags.join(" and ")}.`] : [])],
        buttonLabel: "See your bot features",
        pointsLine: "",
        path: `/bot-features/${feature.key}`,
        footerText: "You're getting this because your coach switched a feature on in your bot.",
      },
      { base: appUrl(), settingsLink: false },
    );
    try {
      await sendEmail(u.email, mail.subject, mail.text, mail.html);
    } catch (e) {
      console.error("[bot-features] on email failed", JSON.stringify({ message: e instanceof Error ? e.message : String(e) }));
    }
  }
  refresh();
}

/** The coach's toggles on a client: the milestones HelixOS can't see (25 bot contacts, an event elsewhere) or that they override. */
export async function setBotUnlocksAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const membershipId = str(formData, "membershipId");
  const picked = formData.getAll("behavior").map(String).filter((b): b is Behavior => (BEHAVIORS as readonly string[]).includes(b));
  await db.update(schema.memberships).set({ botUnlocks: [...new Set(picked)] }).where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}

/** The rules page: one rule per feature, a type and a value. A rule that can't stand is left as it was and named back. */
export async function saveBotRulesAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) redirect("/coach/bot-features");
  const bad: string[] = [];
  for (const key of BOT_FEATURE_KEYS as readonly BotFeatureKey[]) {
    const type = str(formData, `${key}_type`);
    if (!type) continue;
    const rule = readRule(type, str(formData, `${key}_${type}`), TIERS.map((t) => t.name));
    if (!rule) {
      bad.push(featureOf(key)!.name);
      continue;
    }
    await db
      .insert(schema.botFeatureRules)
      .values({ id: newId(), workspaceId: coach.workspace.id, featureKey: key, type: rule.type, value: rule.value })
      .onConflictDoUpdate({ target: [schema.botFeatureRules.workspaceId, schema.botFeatureRules.featureKey], set: { type: rule.type, value: rule.value, updatedAt: nowIso() } });
  }
  refresh();
  redirect(`/coach/bot-features?${bad.length ? new URLSearchParams({ bad: bad.join(", ") }) : "saved=1"}`);
}
