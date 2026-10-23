/**
 * 30 Days in the Arena (H-1562, plan H-1563): the data side. The rules are in src/lib/engine/arena.ts. A member's days closed
 * are read from their daily logs (their own dates, so "close by midnight, your time" holds), and their points from the ledger
 * between the window's two instants. Nothing is copied, so a correction to either shows here at once.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ARENA, ARENA_ENDS_AT, ARENA_HUDDLES, ARENA_STARTS_AT, HUDDLE_POINTS, arenaCard, canEnter, dateIn, fillPods, huddleLive, huddleWhen, leaderWeek, placed, weekInstants, weekWords, type ArenaCard } from "@/lib/engine/arena";
import { A_MEMBER, shortName, type BlockSet } from "@/lib/engine/blocks";
import { award } from "@/lib/queries/points";

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
  await placePods(input.challengeId, input.workspaceId);
}

/** Days closed inside the window, and whether a given day is closed, for one member: one read. */
export async function closesFor(workspaceId: string, userId: string, c: Pick<schema.ArenaChallenge, "startDate" | "endDate">, today: string): Promise<{ daysClosed: number; closedToday: boolean }> {
  const rows = await db
    .select({ date: schema.dailyLogs.date })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.eveningDoneAt), gte(schema.dailyLogs.date, c.startDate), lte(schema.dailyLogs.date, c.endDate)));
  return { daysClosed: new Set(rows.map((r) => r.date)).size, closedToday: rows.some((r) => r.date === today) };
}

export type ArenaRow = { userId: string; membershipId: string; name: string; level: string; joinedAt: string; daysClosed: number; callsBooked: number; points: number; podId: string | null; hidden: boolean };

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
    db.query.memberships.findMany({ where: inArray(schema.memberships.id, entries.map((e) => e.membershipId)), columns: { id: true, programTier: true, arenaHidden: true } }),
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
  const hiddenOf = new Map(memberships.map((m) => [m.id, m.arenaHidden]));
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
    podId: e.podId,
    hidden: hiddenOf.get(e.membershipId) ?? false,
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

/*
 * PR B (plan H-1563): pods, the leaderboard and the Huddle check-in. Names on the member's board are "First L.", or "A member"
 * for someone they blocked or who hid from the arena (the Colosseum's own switch); the coach's page shows full names.
 */

/** Puts every entry without a pod into one, in join order (pods of five). Safe to run again: placed members stay where they are. */
export async function placePods(challengeId: string, workspaceId: string): Promise<void> {
  const [entries, pods] = await Promise.all([
    db.query.arenaEntries.findMany({ where: eq(schema.arenaEntries.challengeId, challengeId), columns: { id: true, podId: true, joinedAt: true } }),
    db.query.arenaPods.findMany({ where: eq(schema.arenaPods.challengeId, challengeId), columns: { id: true }, orderBy: [asc(schema.arenaPods.createdAt), asc(schema.arenaPods.name)] }),
  ]);
  const plan = fillPods(entries, pods);
  if (!plan.assign.length) return;
  const made = new Map<string, string>();
  for (const [i, name] of plan.create.entries()) {
    const id = newId();
    await db.insert(schema.arenaPods).values({ id, workspaceId, challengeId, name });
    made.set(`new:${i}`, id);
  }
  for (const a of plan.assign) {
    await db.update(schema.arenaEntries).set({ podId: made.get(a.pod) ?? a.pod }).where(eq(schema.arenaEntries.id, a.entryId));
  }
}

export type PodMember = { membershipId: string; userId: string; name: string; daysClosed: number; lastClose: string | null; captain: boolean };
export type PodView = { id: string; name: string; captainMembershipId: string | null; members: PodMember[] };

/** The challenge's pods with their members, in the order they were made. Each member's last close is their latest closed day. */
export async function podsFor(workspaceId: string, c: schema.ArenaChallenge, roster?: ArenaRow[]): Promise<PodView[]> {
  const rows = roster ?? (await arenaRoster(workspaceId, c));
  const pods = await db.query.arenaPods.findMany({ where: eq(schema.arenaPods.challengeId, c.id), orderBy: [asc(schema.arenaPods.createdAt), asc(schema.arenaPods.name)] });
  if (!pods.length) return [];
  const userIds = rows.map((r) => r.userId);
  const last = userIds.length
    ? await db
        .select({ userId: schema.dailyLogs.userId, date: sql<string>`max(${schema.dailyLogs.date})` })
        .from(schema.dailyLogs)
        .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), inArray(schema.dailyLogs.userId, userIds), isNotNull(schema.dailyLogs.eveningDoneAt)))
        .groupBy(schema.dailyLogs.userId)
    : [];
  const lastOf = new Map(last.map((l) => [l.userId, l.date]));
  return pods.map((p) => ({
    id: p.id,
    name: p.name,
    captainMembershipId: p.captainMembershipId,
    members: rows
      .filter((r) => r.podId === p.id)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((r) => ({ membershipId: r.membershipId, userId: r.userId, name: r.name, daysClosed: r.daysClosed, lastClose: lastOf.get(r.userId) ?? null, captain: p.captainMembershipId === r.membershipId })),
  }));
}

async function podIn(c: schema.ArenaChallenge, podId: string) {
  if (!podId || podId.length > 64) return null;
  return (await db.query.arenaPods.findFirst({ where: and(eq(schema.arenaPods.id, podId), eq(schema.arenaPods.challengeId, c.id)) })) ?? null;
}

/** The coach moves a member to another pod. A captain who moves stops being that pod's captain. */
export async function movePod(c: schema.ArenaChallenge, membershipId: string, podId: string): Promise<{ ok: boolean; error?: string }> {
  const [entry, pod] = await Promise.all([entryFor(c.id, membershipId), podIn(c, podId)]);
  if (!entry || !pod) return { ok: false, error: "That member or pod isn't in this Arena." };
  if (entry.podId === pod.id) return { ok: true };
  if (entry.podId) await db.update(schema.arenaPods).set({ captainMembershipId: null }).where(and(eq(schema.arenaPods.id, entry.podId), eq(schema.arenaPods.captainMembershipId, membershipId)));
  await db.update(schema.arenaEntries).set({ podId: pod.id }).where(eq(schema.arenaEntries.id, entry.id));
  return { ok: true };
}

/** The coach names a pod's captain: one of its own members. */
export async function setCaptain(c: schema.ArenaChallenge, podId: string, membershipId: string): Promise<{ ok: boolean; error?: string }> {
  const [entry, pod] = await Promise.all([entryFor(c.id, membershipId), podIn(c, podId)]);
  if (!entry || !pod || entry.podId !== pod.id) return { ok: false, error: "A captain has to be in the pod." };
  await db.update(schema.arenaPods).set({ captainMembershipId: membershipId }).where(eq(schema.arenaPods.id, pod.id));
  return { ok: true };
}

/** An empty pod the coach can move members into. */
export async function newPod(c: schema.ArenaChallenge): Promise<string> {
  const n = (await db.query.arenaPods.findMany({ where: eq(schema.arenaPods.challengeId, c.id), columns: { id: true } })).length;
  const id = newId();
  await db.insert(schema.arenaPods).values({ id, workspaceId: c.workspaceId, challengeId: c.id, name: `Pod ${n + 1}` });
  return id;
}

/** The challenge's Huddles, first first. */
export async function huddlesFor(c: schema.ArenaChallenge): Promise<schema.ArenaHuddle[]> {
  return db.query.arenaHuddles.findMany({ where: eq(schema.arenaHuddles.challengeId, c.id), orderBy: asc(schema.arenaHuddles.startsAt) });
}

/** Which Huddles a member checked in to. */
export async function myHuddles(c: schema.ArenaChallenge, membershipId: string): Promise<Set<string>> {
  const rows = await db
    .select({ huddleId: schema.arenaHuddleCheckins.huddleId })
    .from(schema.arenaHuddleCheckins)
    .innerJoin(schema.arenaHuddles, eq(schema.arenaHuddles.id, schema.arenaHuddleCheckins.huddleId))
    .where(and(eq(schema.arenaHuddles.challengeId, c.id), eq(schema.arenaHuddleCheckins.membershipId, membershipId)));
  return new Set(rows.map((r) => r.huddleId));
}

/** Attendance for the coach: how many checked in to each Huddle, and how many Huddles each member came to. */
export async function huddleAttendance(c: schema.ArenaChallenge): Promise<{ byHuddle: Map<string, number>; byMember: Map<string, number> }> {
  const rows = await db
    .select({ huddleId: schema.arenaHuddleCheckins.huddleId, membershipId: schema.arenaHuddleCheckins.membershipId })
    .from(schema.arenaHuddleCheckins)
    .innerJoin(schema.arenaHuddles, eq(schema.arenaHuddles.id, schema.arenaHuddleCheckins.huddleId))
    .where(eq(schema.arenaHuddles.challengeId, c.id));
  const byHuddle = new Map<string, number>();
  const byMember = new Map<string, number>();
  for (const r of rows) {
    byHuddle.set(r.huddleId, (byHuddle.get(r.huddleId) ?? 0) + 1);
    byMember.set(r.membershipId, (byMember.get(r.membershipId) ?? 0) + 1);
  }
  return { byHuddle, byMember };
}

/**
 * "I'm here" at the Huddle that is live now: once per Huddle, for a member who is in, worth HUDDLE_POINTS in the ledger
 * (type huddle, ref the Huddle). The check-in and the points are both once-only, so a second tap changes nothing.
 */
export async function checkInHuddle(input: { c: schema.ArenaChallenge; workspaceId: string; userId: string; membershipId: string; now?: Date }): Promise<{ ok: true; scored: boolean } | { ok: false; error: string }> {
  const entry = await entryFor(input.c.id, input.membershipId);
  if (!entry) return { ok: false, error: "Tap I'm in first: Huddle check-ins are for members in the Arena." };
  const live = huddleLive(input.now ?? new Date(), await huddlesFor(input.c));
  if (!live) return { ok: false, error: "Check-in opens 30 minutes before a Huddle and stays open until 90 minutes after it starts." };
  await db
    .insert(schema.arenaHuddleCheckins)
    .values({ id: newId(), workspaceId: input.workspaceId, userId: input.userId, membershipId: input.membershipId, huddleId: live.id })
    .onConflictDoNothing();
  const scored = await award({ workspaceId: input.workspaceId, userId: input.userId }, "huddle", HUDDLE_POINTS, `Showed up to the Challenge Huddle (${huddleWhen(live.startsAt)})`, `arena-huddle:${live.id}`);
  return { ok: true, scored };
}

export type BoardRow = { userId: string; name: string; points: number; daysClosed: number; callsBooked: number; place: number; isYou: boolean };
export type ArenaBoard = { rows: BoardRow[]; you: BoardRow | null; total: number; leader: { name: string; points: number; week: string } | null };

/** Members' names on the board: "First L.", or "A member" for someone this viewer blocked or who hid from the arena. */
function boardLabel(r: ArenaRow, b: BlockSet, viewerUserId: string): string {
  if (r.userId === viewerUserId) return shortName(r.name);
  return b.users.has(r.userId) || r.hidden ? A_MEMBER : shortName(r.name);
}

/**
 * The Arena leaderboard (PR B): everyone who is in, by points inside the window, then days closed, then calls booked. The top
 * `top` rows and the viewer's own row. From Mon 30 Nov, the last finished week's leader is named at the top.
 */
export async function arenaBoard(v: { workspace: { id: string }; user: { id: string } }, c: schema.ArenaChallenge, blocks: BlockSet, opts: { today: string; top?: number; roster?: ArenaRow[] }): Promise<ArenaBoard> {
  const roster = opts.roster ?? (await arenaRoster(v.workspace.id, c));
  const ranked = placed(roster).map((r) => ({ userId: r.userId, name: boardLabel(r, blocks, v.user.id), points: r.points, daysClosed: r.daysClosed, callsBooked: r.callsBooked, place: r.place, isYou: r.userId === v.user.id }));
  const top = opts.top ?? 25;
  const you = ranked.find((r) => r.isYou) ?? null;
  return { rows: ranked.slice(0, top), you, total: ranked.length, leader: await weeklyLeader(v.workspace.id, c, roster, blocks, v.user.id, opts.today) };
}

/** The last finished week's points leader among those in the Arena, or null before Mon 30 Nov or when nobody scored. */
async function weeklyLeader(workspaceId: string, c: schema.ArenaChallenge, roster: ArenaRow[], blocks: BlockSet, viewerUserId: string, today: string): Promise<ArenaBoard["leader"]> {
  const week = leaderWeek(c, today);
  if (!week || !roster.length) return null;
  const at = weekInstants(week);
  const [best] = await db
    .select({ userId: schema.pointsLedger.userId, total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(
      and(
        eq(schema.pointsLedger.workspaceId, workspaceId),
        inArray(schema.pointsLedger.userId, roster.map((r) => r.userId)),
        ne(schema.pointsLedger.type, "redeem"),
        sql`datetime(${schema.pointsLedger.createdAt}) >= datetime(${at.from})`,
        sql`datetime(${schema.pointsLedger.createdAt}) <= datetime(${at.to})`,
      ),
    )
    .groupBy(schema.pointsLedger.userId)
    .orderBy(sql`sum(${schema.pointsLedger.points}) desc`)
    .limit(1);
  const row = best ? roster.find((r) => r.userId === best.userId) : undefined;
  if (!row || Number(best.total) <= 0) return null;
  return { name: boardLabel(row, blocks, viewerUserId), points: Number(best.total), week: weekWords(week) };
}
