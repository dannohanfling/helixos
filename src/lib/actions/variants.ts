"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { CHANNEL_SPECS, formatClause, repurposeAll, toneClause, type Channel } from "@/lib/engine/repurpose";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { POINTS } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { carriesUnreviewed, originAfterAccept, originAfterSave, variantName } from "@/lib/engine/provenance";
import { recordConfirm } from "@/lib/provenance";
import { redirect } from "next/navigation";

async function ownItem(id: string, userId: string) {
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) throw new Error("Content not found");
  return item;
}

export async function generateVariantsAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const itemId = str(formData, "contentItemId");
  const item = await ownItem(itemId, userId);
  const channels = formData.getAll("channels").map(String).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
  const useAi = str(formData, "ai") === "1";
  const src = { title: item.title, hook: item.hook, body: item.body, hasCta: item.hasCta, ctaText: item.cta, hashtag: v.membership.passHashtag, firstName: null };
  const drafts = repurposeAll(src, channels.length ? channels : undefined);
  let polished: Record<string, { body: string; subject?: string }> | null = null;
  if (useAi) {
    const specs = drafts.map((d) => CHANNEL_SPECS.find((c) => c.key === d.channel)!);
    const text = await draft(
      `You repurpose one piece of coaching content into channel-native drafts. Return ONLY a JSON object keyed by channel key, each value {"body": string, "subject"?: string}. Respect each channel's max length and link rules.`,
      `Source title: ${item.title}\nHook: ${item.hook ?? ""}\nBody:\n${item.body ?? ""}\nHas CTA: ${item.hasCta}${item.cta ? `\nCTA (the closing line, once, where a CTA belongs): ${item.cta}` : ""}\n\nChannels:\n${specs.map((s) => `- ${s.key}: ${s.label}.${toneClause(s)}${formatClause(s)} Max ${s.maxChars} chars. Links: ${s.links}.`).join("\n")}\n\nRule-based starting drafts you may improve:\n${JSON.stringify(Object.fromEntries(drafts.map((d) => [d.channel, d])))}`,
      8000,
      { feature: "repurpose" },
    );
    if (text) {
      try {
        const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
        polished = JSON.parse(json);
      } catch {
        polished = null;
      }
    }
  }
  for (const d of drafts) {
    const p = polished?.[d.channel];
    // A fabricated statistic the model wrote comes out, and the note beside the draft says why.
    const stripped = p?.body?.trim() ? stripFabricated(p.body.trim()) : null;
    const body = stripped?.text || d.body;
    const notes = stripped ? stripNote(stripped.removed) : null;
    const subject = p?.subject ?? d.subject ?? null;
    const existing = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, d.channel), eq(schema.contentVariants.groupId, "")) });
    if (existing && existing.status === "posted") continue;
    const origin = p ? ("ai_unreviewed" as const) : ("rule" as const);
    if (existing) await db.update(schema.contentVariants).set({ body, subject, notes, generatedBy: p ? "claude" : "rules", origin }).where(eq(schema.contentVariants.id, existing.id));
    else await db.insert(schema.contentVariants).values({ id: newId(), contentItemId: itemId, userId, channel: d.channel, body, subject, notes, generatedBy: p ? "claude" : "rules", origin });
  }
  refresh();
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const variant = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.id, id), eq(schema.contentVariants.userId, userId)) });
  if (!variant) return;
  const wanted = (["draft", "scheduled", "posted", "skipped"] as const).find((s) => s === str(formData, "status")) ?? variant.status;
  const body = str(formData, "body") || variant.body;
  // Scheduling or posting is where a draft goes out. An AI draft nobody has read, sent as it stands, is held: everything else on
  // the form saves, the status does not move, and the page names the draft with Review or Continue anyway. confirm=1 is logged.
  const goingOut = (wanted === "scheduled" || wanted === "posted") && wanted !== variant.status;
  const held = goingOut && carriesUnreviewed(variant.origin, variant.body, body) && str(formData, "confirm") !== "1";
  const status = held ? variant.status : wanted;
  if (goingOut && !held && carriesUnreviewed(variant.origin, variant.body, body)) {
    const group = variant.groupId ? await db.query.groups.findFirst({ where: and(eq(schema.groups.id, variant.groupId), eq(schema.groups.userId, userId)), columns: { name: true } }) : null;
    await recordConfirm({ workspaceId, userId, userName: v.user.name }, "variant_status", variant.id, [variantName(variant, group?.name)]);
  }
  await db
    .update(schema.contentVariants)
    .set({
      body,
      origin: originAfterSave(variant.origin, variant.body, body),
      subject: formData.has("subject") ? opt(formData, "subject") : variant.subject,
      status,
      postAt: opt(formData, "postAt") ?? variant.postAt,
      postedAt: status === "posted" ? (variant.postedAt ?? nowIso()) : variant.postedAt,
      postUrl: opt(formData, "postUrl") ?? variant.postUrl,
      reactions: formData.has("reactions") ? num(formData, "reactions") : variant.reactions,
      comments: formData.has("comments") ? num(formData, "comments") : variant.comments,
      dms: formData.has("dms") ? num(formData, "dms") : variant.dms,
      leads: formData.has("leads") ? num(formData, "leads") : variant.leads,
    })
    .where(eq(schema.contentVariants.id, id));
  if (status === "posted" && variant.status !== "posted") {
    await award({ workspaceId, userId }, "content", POINTS.dmStarted, `Repurposed to ${CHANNEL_SPECS.find((c) => c.key === variant.channel)?.label ?? variant.channel}`, `variant:${id}`);
    if (variant.groupId) await db.update(schema.groups).set({ lastPostedAt: nowIso() }).where(and(eq(schema.groups.id, variant.groupId), eq(schema.groups.userId, userId)));
  }
  refresh();
  if (held) redirect(`/content/${variant.contentItemId}/repurpose?gate=variant&variant=${variant.id}&status=${wanted}#variant-${variant.id}`);
  // A confirmed send returns to a clean address, so the answered gate is not shown again.
  if (str(formData, "confirm") === "1") redirect(`/content/${variant.contentItemId}/repurpose`);
}

/** Accept: the coach has read this one variant's AI draft and keeps it. One variant per click; nothing accepts more than one. */
export async function acceptVariantAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const variant = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.id, id), eq(schema.contentVariants.userId, userId)) });
  if (!variant) return;
  await db.update(schema.contentVariants).set({ origin: originAfterAccept(variant.origin) }).where(eq(schema.contentVariants.id, id));
  refresh();
}
