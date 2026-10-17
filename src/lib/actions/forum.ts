"use server";

/**
 * The Forum (rev 765): the member's own changes. Adding, confirming, moving and removing agents, ticking "what needs you",
 * the share switch and the webhook secret are all the member's own: refused while a coach is switched in, and closed to a
 * team member. Ticking an item sends nothing back to the agent.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { forumSettingsFor, makeForumWebhook, moveForumAgent, revokeForumWebhook, type ForumMember } from "@/lib/forum";
import { FORUM_MAX, cleanLine, cleanLink, forumNameKey, looksLikeSecret, plotFor } from "@/lib/engine/forum";
import { cleanSessionUrl } from "@/lib/engine/handoff";
import { agentSettings } from "@/lib/handoff";
import { watchForum } from "@/lib/forum-watch";

const THEIRS = "{first}'s Forum is their own.";
const mine = (m: ForumMember, id: string) => and(eq(schema.forumAgents.workspaceId, m.workspaceId), eq(schema.forumAgents.userId, m.userId), eq(schema.forumAgents.id, id));
const text = (fd: FormData, key: string, max: number): string | null => {
  const s = cleanLine(str(fd, key), max);
  return s && !looksLikeSecret(s) ? s : null;
};

export type ForumFormState = { error?: string; ok?: string; secret?: string; agentId?: string } | null;

export async function addForumAgentAction(_prev: ForumFormState, fd: FormData): Promise<ForumFormState> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const name = text(fd, "name", FORUM_MAX.name);
  if (!name) return { error: "Give the agent a name, as it'll show on its building." };
  const key = forumNameKey(name);
  if (await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, m.workspaceId), eq(schema.forumAgents.userId, m.userId), eq(schema.forumAgents.nameKey, key)) })) return { error: `You already have an agent called ${name}.` };
  const platform = str(fd, "platform") === "Other" ? text(fd, "platformOther", FORUM_MAX.platform) : text(fd, "platform", FORUM_MAX.platform);
  const taken = (await db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, m.workspaceId), eq(schema.forumAgents.userId, m.userId)), columns: { plotId: true } })).map((a) => a.plotId);
  const agentId = newId();
  await db.insert(schema.forumAgents).values({ id: agentId, ...m, name, nameKey: key, platform, role: text(fd, "role", FORUM_MAX.role), link: cleanLink(str(fd, "link")), plotId: plotFor(taken), createdBy: "member", confirmed: true });
  await db.insert(schema.forumEvents).values({ id: newId(), ...m, kind: "member", source: "member", payload: { text: `added ${name}` }, at: nowIso() });
  refresh();
  return { ok: `${name} is on your Forum.`, agentId };
}

export async function editForumAgentAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const id = str(fd, "id");
  const name = text(fd, "name", FORUM_MAX.name);
  if (!id || !name) return;
  const row = await db.query.forumAgents.findFirst({ where: mine(m, id) });
  if (!row) return;
  const key = forumNameKey(name);
  const clash = key !== row.nameKey && (await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, m.workspaceId), eq(schema.forumAgents.userId, m.userId), eq(schema.forumAgents.nameKey, key)) }));
  await db.update(schema.forumAgents).set({ ...(clash || row.builtIn ? {} : { name, nameKey: key }), platform: text(fd, "platform", FORUM_MAX.platform), role: text(fd, "role", FORUM_MAX.role), link: cleanLink(str(fd, "link")), confirmed: true, updatedAt: nowIso() }).where(mine(m, id));
  // H-495: the session link is the one the Agents page and Nudge use, editable from the card too.
  if (fd.has("sessionUrl") && !row.builtIn) {
    const s = await agentSettings(m, row.id);
    await db.update(schema.handoffAgents).set({ sessionUrl: cleanSessionUrl(str(fd, "sessionUrl")) }).where(eq(schema.handoffAgents.id, s.id));
  }
  refresh();
}

/** H-495: "Don't watch this agent" (a stood-down agent, say) and back; muting ends a stall it is in. */
export async function setForumAgentMutedAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const row = await db.query.forumAgents.findFirst({ where: mine(m, str(fd, "id")) });
  if (!row || row.builtIn) return;
  await db.update(schema.forumAgents).set({ stallMuted: str(fd, "on") === "1", updatedAt: nowIso() }).where(mine(m, row.id));
  await watchForum(m);
  refresh();
}

/** "Yes, that's mine": a new agent a report made stops being flagged. */
export async function confirmForumAgentAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  await db.update(schema.forumAgents).set({ confirmed: true, updatedAt: nowIso() }).where(mine(m, str(fd, "id")));
  refresh();
}

/** Remove an agent from the map. Its news stays in the log until it ages out; a later report under its name brings it back as new. */
export async function removeForumAgentAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const row = await db.query.forumAgents.findFirst({ where: mine(m, str(fd, "id")) });
  if (!row || row.builtIn) return;
  await db.delete(schema.forumAgents).where(mine(m, row.id));
  await db.update(schema.forumNeeds).set({ doneAt: nowIso(), doneBy: "member" }).where(and(eq(schema.forumNeeds.workspaceId, m.workspaceId), eq(schema.forumNeeds.userId, m.userId), eq(schema.forumNeeds.agentId, row.id), isNull(schema.forumNeeds.doneAt)));
  await db.insert(schema.forumEvents).values({ id: newId(), ...m, kind: "member", source: "member", payload: { text: `removed ${row.name}` }, at: nowIso() });
  refresh();
}

/** Tap two plots (or drag one onto another) to swap them; the swap is saved. No plot sends the agent to the Outer districts. */
export async function moveForumAgentAction(agentRef: string, plot: string | null): Promise<{ ok: boolean }> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const ok = await moveForumAgent(m, String(agentRef).slice(0, 80), plot ? String(plot) : null);
  if (ok) refresh();
  return { ok };
}

/** Ticked done on What needs you. Nothing goes back to the agent. */
export async function tickForumNeedAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  await db
    .update(schema.forumNeeds)
    .set({ doneAt: nowIso(), doneBy: "member" })
    .where(and(eq(schema.forumNeeds.workspaceId, m.workspaceId), eq(schema.forumNeeds.userId, m.userId), eq(schema.forumNeeds.id, str(fd, "id")), isNull(schema.forumNeeds.doneAt)));
  refresh();
}

export async function setForumShareAction(fd: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  await forumSettingsFor(m);
  await db.update(schema.forumSettings).set({ shareWithCoach: str(fd, "on") === "1" }).where(and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId)));
  refresh();
}

/** Make (or rotate) the webhook secret: shown once, here, and never again. The old one stops at once. */
export async function makeForumWebhookAction(): Promise<ForumFormState> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  const secret = await makeForumWebhook(m);
  refresh();
  return { secret, ok: "Copy it now: it won't be shown again." };
}

export async function revokeForumWebhookAction(): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: THEIRS });
  const m: ForumMember = { workspaceId, userId };
  await revokeForumWebhook(m);
  refresh();
}
