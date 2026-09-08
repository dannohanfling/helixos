import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { connectionFor, getPost, listPosts } from "@/lib/ghl";
import { candidates, classify, type AuditRow, type LoggedLike, type PlannerPostLike, type TrackedLike } from "@/lib/engine/planner-audit";

export type ClientAudit = {
  userId: string;
  userName: string;
  locationId: string;
  accountName: (id: string | null) => string;
  trackedCount: number;
  loggedCount: number;
  plannerListed: number | null;
  plannerError: string | null;
  rows: AuditRow[];
  capped: boolean;
};

const CAP = 40;

/**
 * Read-only. For every client with a GoHighLevel connection: the planner posts HelixOS created and no longer tracks,
 * from two sources (the sync log, which has every id ever created unless it was cleared, and the planner's own
 * scheduled list), each looked up live and classified. Nothing here writes to HelixOS or to GoHighLevel.
 */
export async function plannerAudit(workspaceId: string): Promise<{ clients: ClientAudit[]; unconnected: string[] }> {
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client")) });
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)) }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const clients: ClientAudit[] = [];
  const unconnected: string[] = [];
  for (const m of members) {
    const conn = await connectionFor(m.userId);
    if (!conn) {
      unconnected.push(nameOf.get(m.userId) ?? m.userId);
      continue;
    }
    const [variants, events] = await Promise.all([
      db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.userId, m.userId), isNotNull(schema.contentVariants.externalId)) }),
      db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.workspaceId, workspaceId), eq(schema.syncEvents.userId, m.userId), eq(schema.syncEvents.provider, "gohighlevel"), eq(schema.syncEvents.direction, "out"), eq(schema.syncEvents.status, "sent")), orderBy: desc(schema.syncEvents.createdAt) }),
    ]);
    const items = variants.length ? await db.query.contentItems.findMany({ where: inArray(schema.contentItems.id, [...new Set(variants.map((v) => v.contentItemId))]) }) : [];
    const titleOf = new Map(items.map((i) => [i.id, i.title]));
    const tracked: TrackedLike[] = variants.map((v) => ({ variantId: v.id, externalId: v.externalId!, channel: v.channel, body: v.subject ? `${v.subject}\n\n${v.body}` : v.body, itemTitle: titleOf.get(v.contentItemId) ?? "(deleted post)", postAt: v.postAt }));
    const logged: LoggedLike[] = events
      .filter((e) => (e.event === "social.schedule" || e.event === "social.update") && typeof e.payload.ghlPostId === "string" && e.payload.ghlPostId)
      .map((e) => ({ ghlPostId: String(e.payload.ghlPostId), channel: typeof e.payload.channel === "string" ? e.payload.channel : null, accountId: typeof e.payload.accountId === "string" ? e.payload.accountId : null, loggedAt: e.createdAt }));
    const listed = await listPosts(conn, "scheduled");
    const planner: PlannerPostLike[] | null = listed.ok ? listed.data : null;
    const plannerById = new Map((planner ?? []).map((p) => [p.id, p]));
    const all = candidates(tracked, logged, planner);
    const rows: AuditRow[] = [];
    for (const c of all.slice(0, CAP)) {
      let live: PlannerPostLike | null = plannerById.get(c.ghlPostId) ?? null;
      let liveError: string | null = null;
      if (!live) {
        const r = await getPost(conn, c.ghlPostId);
        if (r.ok) live = { id: c.ghlPostId, status: r.data.status, summary: r.data.summary, scheduleDate: r.data.scheduleDate, accountIds: r.data.accountIds };
        else if (r.status !== 404) liveError = r.error;
      }
      rows.push(classify(c, live, liveError, tracked, conn.mapping, plannerById));
    }
    const accounts = conn.accounts;
    clients.push({
      userId: m.userId,
      userName: nameOf.get(m.userId) ?? m.userId,
      locationId: conn.locationId,
      accountName: (id) => (id ? (accounts.find((a) => a.id === id)?.name ?? id) : "unknown account"),
      trackedCount: tracked.length,
      loggedCount: new Set(logged.map((l) => l.ghlPostId)).size,
      plannerListed: planner ? planner.length : null,
      plannerError: listed.ok ? null : listed.error,
      rows,
      capped: all.length > CAP,
    });
  }
  return { clients, unconnected };
}
