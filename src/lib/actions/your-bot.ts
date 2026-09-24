"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { pushBotFields, stage1InputFor, textHash } from "@/lib/community-loyalty";
import { PRICE_MODES, needsEyes } from "@/lib/engine/bot-fields";

/**
 * The "Your bot" page's actions, for the member's own bot or, for their coach, any member's in the workspace (rev 80: clients push
 * their own bot, and the coach can still push for anyone). Each goes back to the page it came from, and only to one of the two.
 */
async function botOwner(v: Awaited<ReturnType<typeof ctx>>["v"], formData: FormData) {
  const membershipId = str(formData, "membershipId") || v.membership.id;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || (m.userId !== v.user.id && v.role !== "coach")) redirect("/brain");
  const back = m.userId === v.user.id ? "/brain" : `/coach/${m.id}/bot`;
  return { m, back };
}

/** Push what the page showed, carried by its key: the same checks and fingerprint whoever presses it. */
export async function pushYourBotAction(formData: FormData): Promise<void> {
  const { v } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const self = m.userId === v.user.id;
  const out = await pushBotFields(m.id, { key: str(formData, "key"), reason: self ? (v.role === "coach" ? "own bot" : "client push") : "coach push", by: v.user.id });
  refresh();
  if (out.status === "sent") redirect(`${back}?pushed=${out.fields.length}#your-bot`);
  if (out.status === "changed") redirect(`${back}?changed=1#your-bot`);
  redirect(`${back}?${out.status === "failed" ? "failed" : "note"}=${encodeURIComponent(out.note)}#your-bot`);
}

/** Approve one Needs-your-eyes line: its exact text as composed now, never a line the page merely named. One at a time. */
export async function approveBotLineAction(formData: FormData): Promise<void> {
  const { v } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const key = str(formData, "key");
  const line = needsEyes(await stage1InputFor(m)).find((l) => l.key === key);
  if (line) await db.insert(schema.botApprovals).values({ id: newId(), membershipId: m.id, elementKey: key, textHash: textHash(line.text), approvedBy: v.user.id }).onConflictDoNothing();
  refresh();
  redirect(`${back}#eyes`);
}

/** The lines that exist only for the bot, edited where they are shown: price handling, the range and payment plan lines, the guarantee and its coverage. */
export async function saveBotLinesAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const mode = PRICE_MODES.find((p) => p === str(formData, "priceMode")) ?? m.priceMode;
  await db
    .update(schema.memberships)
    .set({ priceMode: mode, rangeLine: opt(formData, "rangeLine"), paymentPlanLine: opt(formData, "paymentPlanLine"), priceAnswer: opt(formData, "priceAnswer"), guaranteeLine: opt(formData, "guaranteeLine"), guaranteeCoverageLine: opt(formData, "guaranteeCoverageLine") })
    .where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}?saved=1#lines`);
}
