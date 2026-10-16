/**
 * On the horizon (H-385, plan H-387), the server side: the workspace's items (seeded once from the engine's first list), a
 * member's wants, the coach's edits, and what the shell needs (which menu entries have shipped, the one-time "it shipped"
 * notice). The rules themselves are pure, in src/lib/engine/horizon.ts.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { HORIZON_SEED, VOTABLE, shippedMenuKeys, shippedNotice, visibleItems, type HorizonArea, type HorizonStatus } from "@/lib/engine/horizon";

/** The workspace's items, seeding the first list on the first read so no workspace ever shows an empty page. */
export async function horizonItems(workspaceId: string): Promise<schema.HorizonItem[]> {
  const rows = await db.query.horizonItems.findMany({ where: eq(schema.horizonItems.workspaceId, workspaceId) });
  if (rows.length) return rows;
  await db.insert(schema.horizonItems).values(HORIZON_SEED.map((s) => ({ id: newId(), workspaceId, ...s })));
  return db.query.horizonItems.findMany({ where: eq(schema.horizonItems.workspaceId, workspaceId) });
}

export type HorizonView = { items: (schema.HorizonItem & { wanted: boolean; votable: boolean })[]; wantedCount: number };

/** What a member sees: the visible items with their own Want on each; nobody else's votes. */
export async function horizonFor(v: Viewer, now: Date = new Date()): Promise<HorizonView> {
  const [items, wants] = await Promise.all([horizonItems(v.workspace.id), myWants(v)]);
  const mine = new Set(wants.map((w) => w.itemId));
  const visible = visibleItems(items, now).map((i) => ({ ...i, wanted: mine.has(i.id), votable: VOTABLE.has(i.status) }));
  return { items: visible, wantedCount: visible.filter((i) => i.wanted).length };
}

async function myWants(v: Viewer): Promise<schema.HorizonWant[]> {
  return db.query.horizonWants.findMany({ where: and(eq(schema.horizonWants.workspaceId, v.workspace.id), eq(schema.horizonWants.userId, v.user.id)) });
}

/** Want this, or not any more: only on a visible item in a list members vote on. Returns the member's state after. */
export async function toggleWant(v: Viewer, itemId: string): Promise<{ wanted: boolean } | { error: string }> {
  const item = await db.query.horizonItems.findFirst({ where: and(eq(schema.horizonItems.id, itemId), eq(schema.horizonItems.workspaceId, v.workspace.id)) });
  if (!item || item.hidden || !VOTABLE.has(item.status)) return { error: "That one isn't open for votes." };
  const had = await db.query.horizonWants.findFirst({ where: and(eq(schema.horizonWants.workspaceId, v.workspace.id), eq(schema.horizonWants.userId, v.user.id), eq(schema.horizonWants.itemId, itemId)) });
  if (had) {
    await db.delete(schema.horizonWants).where(eq(schema.horizonWants.id, had.id));
    return { wanted: false };
  }
  await db.insert(schema.horizonWants).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, itemId });
  return { wanted: true };
}

export type HorizonShell = { shippedKeys: string[]; notice: { itemId: string; title: string; line: string } | null };

/**
 * What the shell needs on every page: the menu keys whose item has shipped (Coming soon comes off), and for a client in their
 * own session the one item they wanted that has since shipped and has not been shown yet. Never seeds: a workspace with no
 * items yet reads as nothing shipped, which is the menu as it was.
 */
export async function horizonShell(v: Viewer): Promise<HorizonShell> {
  const items = await db.query.horizonItems.findMany({ where: eq(schema.horizonItems.workspaceId, v.workspace.id), columns: { id: true, title: true, line: true, area: true, status: true, fromFeedback: true, sort: true, shippedAt: true, menuKey: true, hidden: true } });
  const shippedKeys = [...shippedMenuKeys(items)];
  if (v.role !== "client" || v.switchedInto || v.team) return { shippedKeys, notice: null };
  const wants = await db.query.horizonWants.findMany({ where: and(eq(schema.horizonWants.workspaceId, v.workspace.id), eq(schema.horizonWants.userId, v.user.id), isNull(schema.horizonWants.notifiedAt)), columns: { itemId: true, notifiedAt: true } });
  const due = wants.length ? shippedNotice(items, wants) : null;
  return { shippedKeys, notice: due ? { itemId: due.id, title: due.title, line: due.line } : null };
}

/** The notice was shown and dismissed: stamped on the want, so it never shows again. */
export async function dismissShippedNotice(v: Viewer, itemId: string): Promise<void> {
  await db.update(schema.horizonWants).set({ notifiedAt: nowIso() }).where(and(eq(schema.horizonWants.workspaceId, v.workspace.id), eq(schema.horizonWants.userId, v.user.id), eq(schema.horizonWants.itemId, itemId), isNull(schema.horizonWants.notifiedAt)));
}

/* The coach's side. */

export type CoachHorizonItem = schema.HorizonItem & { wants: number; names: string[] };

/** Every item, hidden ones too, with how many members want it and who (names: the coach's, never a member's). */
export async function horizonForCoach(workspaceId: string): Promise<CoachHorizonItem[]> {
  const items = await horizonItems(workspaceId);
  const wants = await db.query.horizonWants.findMany({ where: eq(schema.horizonWants.workspaceId, workspaceId), orderBy: [desc(schema.horizonWants.createdAt)] });
  const userIds = [...new Set(wants.map((w) => w.userId))];
  const users = userIds.length ? await db.query.users.findMany({ where: inArray(schema.users.id, userIds), columns: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return items
    .map((i) => {
      const w = wants.filter((x) => x.itemId === i.id);
      return { ...i, wants: w.length, names: w.map((x) => nameOf.get(x.userId) ?? "A member") };
    })
    .sort((a, b) => a.sort - b.sort || b.id.localeCompare(a.id));
}

export type HorizonFields = { title: string; line: string; area: HorizonArea; status: HorizonStatus; fromFeedback: boolean; menuKey: string | null };

/** A new item lands at the end of its list. */
export async function addHorizonItem(workspaceId: string, f: HorizonFields): Promise<string> {
  const items = await horizonItems(workspaceId);
  const sort = Math.max(0, ...items.map((i) => i.sort)) + 10;
  const id = newId();
  await db.insert(schema.horizonItems).values({ id, workspaceId, ...f, sort, shippedAt: f.status === "shipped" ? nowIso() : null });
  return id;
}

/** Edit in place; moving to Just shipped stamps shippedAt (kept if it already had one); leaving it clears the stamp. */
export async function saveHorizonItem(workspaceId: string, id: string, f: HorizonFields): Promise<boolean> {
  const had = await db.query.horizonItems.findFirst({ where: and(eq(schema.horizonItems.id, id), eq(schema.horizonItems.workspaceId, workspaceId)) });
  if (!had) return false;
  const shippedAt = f.status === "shipped" ? (had.shippedAt ?? nowIso()) : null;
  await db.update(schema.horizonItems).set({ ...f, shippedAt, updatedAt: nowIso() }).where(eq(schema.horizonItems.id, id));
  return true;
}

export async function setHorizonHidden(workspaceId: string, id: string, hidden: boolean): Promise<void> {
  await db.update(schema.horizonItems).set({ hidden, updatedAt: nowIso() }).where(and(eq(schema.horizonItems.id, id), eq(schema.horizonItems.workspaceId, workspaceId)));
}

/** Move to another list: a quick action on the coach's card. */
export async function moveHorizonItem(workspaceId: string, id: string, status: HorizonStatus): Promise<void> {
  const had = await db.query.horizonItems.findFirst({ where: and(eq(schema.horizonItems.id, id), eq(schema.horizonItems.workspaceId, workspaceId)) });
  if (!had) return;
  await db.update(schema.horizonItems).set({ status, shippedAt: status === "shipped" ? (had.shippedAt ?? nowIso()) : null, updatedAt: nowIso() }).where(eq(schema.horizonItems.id, id));
}

/** Up or down one place inside its list: the two items swap sort values. */
export async function reorderHorizonItem(workspaceId: string, id: string, dir: "up" | "down"): Promise<void> {
  const items = (await horizonItems(workspaceId)).sort((a, b) => a.sort - b.sort || b.id.localeCompare(a.id));
  const me = items.find((i) => i.id === id);
  if (!me) return;
  const list = items.filter((i) => i.status === me.status);
  const at = list.findIndex((i) => i.id === id);
  const other = list[dir === "up" ? at - 1 : at + 1];
  if (!other) return;
  // Two items sharing a sort value would not swap; spread them first.
  const [a, b] = me.sort === other.sort ? [me.sort, me.sort + 1] : [me.sort, other.sort];
  await db.update(schema.horizonItems).set({ sort: b, updatedAt: nowIso() }).where(eq(schema.horizonItems.id, me.id));
  await db.update(schema.horizonItems).set({ sort: a, updatedAt: nowIso() }).where(eq(schema.horizonItems.id, other.id));
}
