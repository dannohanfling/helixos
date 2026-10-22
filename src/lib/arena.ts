/**
 * 30 Days in the Arena (H-1562, plan H-1563): the data side. The rules are in src/lib/engine/arena.ts. A member's days closed
 * are read from their daily logs (their own dates, so "close by midnight, your time" holds), and their points from the ledger
 * between the window's two instants. Nothing is copied, so a correction to either shows here at once.
 */
import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ARENA, ARENA_ENDS_AT, ARENA_HUDDLES, ARENA_STARTS_AT, arenaCard, canEnter, dateIn, type ArenaCard } from "@/lib/engine/arena";

/** The workspace's Arena: made the first time it is read, with the plan's dates and the four Huddles. */
export async function arenaFor(workspaceId: string): Promise<schema.ArenaChallenge> {
  const found = await db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, workspaceId), eq(schema.arenaChallenges.slug, ARENA.slug)) });
  if (found) return found;
  await db
    .insert(schema.arenaChallenges)
    .values({ id: newId(), workspaceId, slug: ARENA.slug, name: ARENA.name, startDate: ARENA.startDate, endDate: ARENA.endDate, joinBy: ARENA.joinBy, timezone: ARENA.timezone, targetDays: ARENA.targetDays })
    .onConflictDoNothing();
  const made = (await db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, workspaceId), eq(schema.arenaChallenges.slug, ARENA.slug)) }))!;
  await db
    .insert(schema.arenaHuddles)
    .values(ARENA_HUDDLES.map((h) => ({ id: newId(), workspaceId, challengeId: made.id, startsAt: h.startsAt, label: h.label })))
    .onConflictDoNothing();
  return made;
}

/** The workspace's Arena if it has been made, without making it (Today reads this, so a page view never writes). */
export async function arenaIfAny(workspaceId: string): Promise<schema.ArenaChallenge | undefined> {
  return db.query.arenaChallenges.findFirst({ where: and(eq(schema.arenaChallenges.workspaceId, workspaceId), eq(schema.arenaChallenges.slug, ARENA.slug)) });
}

export async function entryFor(challengeId: string, membershipId: string): Promise<schema.ArenaEntry | undefined> {
  return db.query.arenaEntries.findFirst({ where: and(eq(schema.arenaEntries.challengeId, challengeId), eq(schema.arenaEntries.membershipId, membershipId)) });
}

/** "I'm in": one entry per member per challenge; a second tap changes nothing. */
export async function enroll(input: { challengeId: string; workspaceId: string; userId: string; membershipId: string }): Promise<void> {
  await db
    .insert(schema.arenaEntries)
    .values({ id: newId(), workspaceId: input.workspaceId, userId: input.userId, membershipId: input.membershipId, challengeId: input.challengeId, joinedAt: nowIso() })
    .onConflictDoNothing();
}

/** Days closed inside the window, and whether a given day is closed, for one member: one read. */
export async function closesFor(workspaceId: string, userId: string, c: Pick<schema.ArenaChallenge, "startDate" | "endDate">, today: string): Promise<{ daysClosed: number; closedToday: boolean }> {
  const rows = await db
    .select({ date: schema.dailyLogs.date })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.eveningDoneAt), gte(schema.dailyLogs.date, c.startDate), lte(schema.dailyLogs.date, c.endDate)));
  return { daysClosed: new Set(rows.map((r) => r.date)).size, closedToday: rows.some((r) => r.date === today) };
}

export type ArenaRow = { userId: string; membershipId: string; name: string; level: string; joinedAt: string; daysClosed: number; callsBooked: number; points: number };

/**
 * Everyone in a workspace's Arena with their days closed, calls booked and points in the window: four reads for the whole list,
 * never one per member. Names are for the coach's own page only, never a log.
 */
export async function arenaRoster(workspaceId: string, c: schema.ArenaChallenge): Promise<ArenaRow[]> {
  const entries = await db.query.arenaEntries.findMany({ where: eq(schema.arenaEntries.challengeId, c.id) });
  if (!entries.length) return [];
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const inWindow = and(eq(schema.dailyLogs.workspaceId, workspaceId), inArray(schema.dailyLogs.userId, userIds), gte(schema.dailyLogs.date, c.startDate), lte(schema.dailyLogs.date, c.endDate));
  const [users, memberships, logs, points] = await Promise.all([
    db.query.users.findMany({ where: inArray(schema.users.id, userIds), columns: { id: true, name: true } }),
    db.query.memberships.findMany({ where: inArray(schema.memberships.id, entries.map((e) => e.membershipId)), columns: { id: true, programTier: true } }),
    db
      .select({ userId: schema.dailyLogs.userId, closed: sql<number>`count(distinct case when ${schema.dailyLogs.eveningDoneAt} is not null then ${schema.dailyLogs.date} end)`, booked: sql<number>`coalesce(sum(${schema.dailyLogs.callsBooked}), 0)` })
      .from(schema.dailyLogs)
      .where(inWindow)
      .groupBy(schema.dailyLogs.userId),
    db
      .select({ userId: schema.pointsLedger.userId, total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
      .from(schema.pointsLedger)
      .where(
        and(
          eq(schema.pointsLedger.workspaceId, workspaceId),
          inArray(schema.pointsLedger.userId, userIds),
          ne(schema.pointsLedger.type, "redeem"),
          // The ledger's own times are SQLite's "YYYY-MM-DD HH:MM:SS" or ISO; datetime() reads both the same way.
          sql`datetime(${schema.pointsLedger.createdAt}) >= datetime(${ARENA_STARTS_AT})`,
          sql`datetime(${schema.pointsLedger.createdAt}) <= datetime(${ARENA_ENDS_AT})`,
        ),
      )
      .groupBy(schema.pointsLedger.userId),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const levelOf = new Map(memberships.map((m) => [m.id, m.programTier]));
  const logOf = new Map(logs.map((l) => [l.userId, l]));
  const pointsOf = new Map(points.map((p) => [p.userId, Number(p.total)]));
  return entries.map((e) => ({
    userId: e.userId,
    membershipId: e.membershipId,
    name: nameOf.get(e.userId) ?? "A member",
    level: levelOf.get(e.membershipId) ?? "",
    joinedAt: e.joinedAt,
    daysClosed: Number(logOf.get(e.userId)?.closed ?? 0),
    callsBooked: Number(logOf.get(e.userId)?.booked ?? 0),
    points: pointsOf.get(e.userId) ?? 0,
  }));
}

/**
 * The Today card for one member (H-1563 PR A): an invite while joining is open, then the wait, the day and the end. Reads only:
 * a member who opens Today before anyone has opened the Arena page still gets the invite, from the plan's own dates.
 */
export async function arenaTodayCard(v: { role: string; team: unknown; today: string; workspace: { id: string }; user: { id: string }; membership: { id: string; programTier: string } }): Promise<ArenaCard | null> {
  if (!canEnter({ role: v.role, programTier: v.membership.programTier, team: Boolean(v.team) })) return null;
  const now = new Date();
  const zoneToday = dateIn(ARENA.timezone, now);
  const c = await arenaIfAny(v.workspace.id);
  const entry = c ? await entryFor(c.id, v.membership.id) : undefined;
  const closes = c && entry ? await closesFor(v.workspace.id, v.user.id, c, v.today) : { daysClosed: 0, closedToday: false };
  return arenaCard({ joined: Boolean(entry), today: zoneToday, daysClosed: closes.daysClosed, closedToday: closes.closedToday, now });
}
