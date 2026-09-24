"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { pushBotFields, stage1InputFor, textHash } from "@/lib/community-loyalty";
import { DEFAULT_PATHS, needsEyes } from "@/lib/engine/bot-fields";
import type { BotExampleRow, BotStoryRow } from "@/db/schema";

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

/**
 * The lines that exist only for the bot, edited where they are shown: the early price answer, the default path, the call, the
 * one-on-one range, payment plans, the guarantee promise and its lead-in, and what the coach calls the people they work with.
 */
export async function saveBotLinesAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const minutes = Number(str(formData, "callMinutes"));
  await db
    .update(schema.memberships)
    .set({
      priceAnswer: opt(formData, "priceAnswer"),
      defaultPath: DEFAULT_PATHS.find((p) => p === str(formData, "defaultPath")) ?? m.defaultPath,
      callMinutes: Number.isInteger(minutes) && minutes > 0 ? minutes : null,
      oneOnOneRange: opt(formData, "oneOnOneRange"),
      paymentPlanLine: opt(formData, "paymentPlanLine"),
      guaranteeLine: opt(formData, "guaranteeLine"),
      guaranteeLeadIn: opt(formData, "guaranteeLeadIn"),
      peopleWord: opt(formData, "peopleWord"),
    })
    .where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}?saved=1#lines`);
}

/** One HOW I SAY IT example, added or edited in place (by its id). The moment and what the coach says are required. */
export async function saveBotExampleAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const row: BotExampleRow = { id: str(formData, "id") || newId(), moment: str(formData, "moment").trim(), them: opt(formData, "them"), me: str(formData, "me").trim(), kind: str(formData, "kind") === "objection" ? "objection" : "normal" };
  if (!row.moment || !row.me) redirect(`${back}?exampleMissing=1#examples`);
  const list = m.botExamples.some((e) => e.id === row.id) ? m.botExamples.map((e) => (e.id === row.id ? row : e)) : [...m.botExamples, row];
  await db.update(schema.memberships).set({ botExamples: list }).where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}#examples`);
}

export async function deleteBotExampleAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  await db.update(schema.memberships).set({ botExamples: m.botExamples.filter((e) => e.id !== str(formData, "id")) }).where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}#examples`);
}

/** One of the coach's own stories, added or edited in place. A belief story carries the belief it answers; a plain one, when it fits. */
export async function saveBotStoryAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  const kind = str(formData, "kind") === "belief" ? "belief" : "plain";
  const row: BotStoryRow = { id: str(formData, "id") || newId(), text: str(formData, "text").trim(), kind, when: kind === "plain" ? opt(formData, "when") : null, belief: kind === "belief" ? opt(formData, "belief") : null };
  if (!row.text || (kind === "belief" && !row.belief)) redirect(`${back}?storyMissing=1#stories`);
  const list = m.botStories.some((e) => e.id === row.id) ? m.botStories.map((e) => (e.id === row.id ? row : e)) : [...m.botStories, row];
  await db.update(schema.memberships).set({ botStories: list }).where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}#stories`);
}

export async function deleteBotStoryAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx();
  const { m, back } = await botOwner(v, formData);
  await db.update(schema.memberships).set({ botStories: m.botStories.filter((e) => e.id !== str(formData, "id")) }).where(and(eq(schema.memberships.id, m.id), eq(schema.memberships.workspaceId, workspaceId)));
  refresh();
  redirect(`${back}#stories`);
}
