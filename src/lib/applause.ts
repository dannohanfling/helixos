/**
 * Applause on Colosseum wins (H-1171, plan H-1177): the 👏 toggle, its points, who applauded, and the Today line. The rules are
 * in src/lib/engine/applause.ts. Every award goes through `award` with its own key, so nothing scores twice; a take-back is a
 * minus row. The member's own: refused while a coach is switched in (the action checks), never on your own win.
 */
import { and, desc, eq, gt, inArray, isNull, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { award } from "@/lib/queries/points";
import { instantOf, todayInTz } from "@/lib/dates";
import { A_MEMBER, shortName, type BlockSet } from "@/lib/engine/blocks";
import { applauderPoints, applauseLine, keys, reasons, winnerPoints } from "@/lib/engine/applause";

type Who = { workspaceId: string; userId: string; role: "coach" | "client"; tz: string; firstName: string };

/** Points already in the ledger for one member under keys starting with `prefix`. */
async function ledgerSum(workspaceId: string, userId: string, prefix: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(
      and(
        eq(schema.pointsLedger.workspaceId, workspaceId),
        eq(schema.pointsLedger.userId, userId),
        like(schema.pointsLedger.refId, `${prefix}%`),
      ),
    );
  return Number(row?.n ?? 0);
}

/** What applauding has earned this member today (their own day), take-backs included. */
async function applaudedToday(who: Who): Promise<number> {
  const rows = await db.query.pointsLedger.findMany({
    where: and(eq(schema.pointsLedger.workspaceId, who.workspaceId), eq(schema.pointsLedger.userId, who.userId), sql`(${schema.pointsLedger.refId} LIKE 'applaud:%' OR ${schema.pointsLedger.refId} LIKE 'unapplaud:%')`),
    columns: { points: true, createdAt: true },
    orderBy: desc(schema.pointsLedger.createdAt),
    limit: 200,
  });
  const today = todayInTz(who.tz);
  return rows.filter((r) => todayInTz(who.tz, instantOf(r.createdAt)) === today).reduce((t, r) => t + r.points, 0);
}

async function winOf(workspaceId: string, winId: string) {
  return db.query.colosseumWins.findFirst({ where: and(eq(schema.colosseumWins.workspaceId, workspaceId), eq(schema.colosseumWins.id, winId), isNull(schema.colosseumWins.hiddenAt)) });
}

export type ApplaudResult = { ok: true; on: boolean } | { ok: false; error: string };

/** 👏 on or off. On: the row, then the applauder's points (capped a day) and the winner's (capped a win). */
export async function applaud(who: Who, winId: string, on: boolean, blocks: BlockSet): Promise<ApplaudResult> {
  const win = await winOf(who.workspaceId, winId);
  if (!win || blocks.users.has(win.userId) || blocks.wins.has(win.id)) return { ok: false, error: "That win isn't here anymore." };
  if (win.userId === who.userId) return { ok: false, error: "That's your own win." };
  if (!on) return unapplaud(who, win);
  const res = await db.insert(schema.winApplause).values({ id: crypto.randomUUID(), workspaceId: who.workspaceId, winId, userId: who.userId }).onConflictDoNothing();
  if ((res.rowsAffected ?? 0) === 0) return { ok: true, on: true };
  const mine = applauderPoints(who.role, await applaudedToday(who));
  if (mine > 0) await award({ workspaceId: who.workspaceId, userId: who.userId }, "community", mine, reasons.applauded, keys.applauded(winId));
  const received = await ledgerSum(who.workspaceId, win.userId, keys.receivedPrefix(winId));
  const theirs = winnerPoints(who.role === "coach", received);
  if (theirs > 0) await award({ workspaceId: who.workspaceId, userId: win.userId }, "community", theirs, who.role === "coach" ? reasons.receivedFromCoach(who.firstName) : reasons.received, keys.received(winId, who.userId));
  return { ok: true, on: true };
}

/** 👏 off: the row goes; on the same day it was given, its points come back off as minus rows (once each). */
async function unapplaud(who: Who, win: schema.ColosseumWin): Promise<ApplaudResult> {
  const row = await db.query.winApplause.findFirst({ where: and(eq(schema.winApplause.winId, win.id), eq(schema.winApplause.userId, who.userId)) });
  if (!row) return { ok: true, on: false };
  await db.delete(schema.winApplause).where(eq(schema.winApplause.id, row.id));
  if (todayInTz(who.tz, instantOf(row.createdAt)) !== todayInTz(who.tz)) return { ok: true, on: false };
  const given = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, who.userId), eq(schema.pointsLedger.refId, keys.applauded(win.id))) });
  if (given && given.points > 0) await award({ workspaceId: who.workspaceId, userId: who.userId }, "community", -given.points, reasons.unapplauded, keys.unapplauded(win.id));
  const got = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, win.userId), eq(schema.pointsLedger.refId, keys.received(win.id, who.userId))) });
  if (got && got.points > 0) await award({ workspaceId: who.workspaceId, userId: win.userId }, "community", -got.points, reasons.unreceived, keys.unreceived(win.id, who.userId));
  return { ok: true, on: false };
}

/** A win taken down: the winner's applause points on it come off as one minus row; the applauders keep theirs. */
export async function takeDownApplause(m: { workspaceId: string; userId: string }, winId: string): Promise<void> {
  const got = (await ledgerSum(m.workspaceId, m.userId, keys.receivedPrefix(winId))) + (await ledgerSum(m.workspaceId, m.userId, `unapplauded:${winId}:`));
  if (got > 0) await award(m, "community", -got, reasons.takenDown, keys.takenDown(winId));
  await db.delete(schema.winApplause).where(and(eq(schema.winApplause.workspaceId, m.workspaceId), eq(schema.winApplause.winId, winId)));
}

/** Sharing a win: +10 once a day. A win shared today that comes down takes it back, unless another win shared today stands. */
export async function shareApplausePoints(m: { workspaceId: string; userId: string }, tz: string): Promise<void> {
  await award(m, "community", 10, reasons.shared, keys.shared(todayInTz(tz)));
}
export async function unshareApplausePoints(m: { workspaceId: string; userId: string }, tz: string, removed: schema.ColosseumWin): Promise<void> {
  const today = todayInTz(tz);
  if (todayInTz(tz, instantOf(removed.createdAt)) !== today) return;
  const others = await db.query.colosseumWins.findMany({ where: and(eq(schema.colosseumWins.workspaceId, m.workspaceId), eq(schema.colosseumWins.userId, m.userId)), columns: { createdAt: true } });
  if (others.some((w) => todayInTz(tz, instantOf(w.createdAt)) === today)) return;
  const got = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, m.userId), eq(schema.pointsLedger.refId, keys.shared(today))) });
  if (got && got.points > 0) await award(m, "community", -got.points, reasons.unshared, keys.unshared(today));
}

export type Applause = { count: number; mine: boolean; who: string[] };

/**
 * Applause on these wins as one viewer sees it: the count, whether they applauded, and who, first names by each member's
 * Colosseum setting ("A member" when they hide from the arena or the viewer blocked them).
 */
export async function applauseOn(workspaceId: string, winIds: string[], viewerUserId: string, blocks: BlockSet): Promise<Map<string, Applause>> {
  const out = new Map<string, Applause>(winIds.map((id) => [id, { count: 0, mine: false, who: [] }]));
  if (!winIds.length) return out;
  const rows = await db.select().from(schema.winApplause).where(and(eq(schema.winApplause.workspaceId, workspaceId), inArray(schema.winApplause.winId, winIds))).orderBy(desc(schema.winApplause.createdAt));
  if (!rows.length) return out;
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [users, members] = await Promise.all([
    db.query.users.findMany({ where: inArray(schema.users.id, userIds), columns: { id: true, name: true } }),
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), inArray(schema.memberships.userId, userIds)), columns: { userId: true, arenaHidden: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const hidden = new Set(members.filter((m) => m.arenaHidden).map((m) => m.userId));
  for (const r of rows) {
    const a = out.get(r.winId)!;
    a.count++;
    if (r.userId === viewerUserId) a.mine = true;
    a.who.push(r.userId === viewerUserId ? "You" : hidden.has(r.userId) || blocks.users.has(r.userId) ? A_MEMBER : shortName(nameOf.get(r.userId) ?? "Member"));
  }
  return out;
}

/** Today's line for the winner: applause on their wins since they last closed it, grouped once a day, newest win first. */
export async function applauseNews(v: { workspace: { id: string }; user: { id: string }; membership: { applauseSeenAt: string | null } }): Promise<{ line: string; winId: string } | null> {
  const since = v.membership.applauseSeenAt;
  const rows = await db
    .select({ winId: schema.winApplause.winId, by: schema.winApplause.userId, text: schema.colosseumWins.text, at: schema.winApplause.createdAt })
    .from(schema.winApplause)
    .innerJoin(schema.colosseumWins, eq(schema.colosseumWins.id, schema.winApplause.winId))
    .where(and(eq(schema.winApplause.workspaceId, v.workspace.id), eq(schema.colosseumWins.userId, v.user.id), isNull(schema.colosseumWins.hiddenAt), since ? gt(schema.winApplause.createdAt, since) : undefined))
    .orderBy(desc(schema.winApplause.createdAt));
  if (!rows.length) return null;
  const winId = rows[0].winId;
  const on = rows.filter((r) => r.winId === winId);
  const coaches = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "coach"), inArray(schema.memberships.userId, on.map((r) => r.by))), columns: { userId: true } });
  let coachOnly: string | null = null;
  if (on.length === 1 && coaches.length === 1) {
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, coaches[0].userId), columns: { name: true } });
    coachOnly = (u?.name ?? "Your coach").trim().split(/\s+/)[0];
  }
  return { line: applauseLine({ count: on.length, coachOnly, text: rows[0].text }), winId };
}

/** ✕ on the Today line: seen up to now. */
export async function markApplauseSeen(membershipId: string): Promise<void> {
  await db.update(schema.memberships).set({ applauseSeenAt: new Date().toISOString().slice(0, 19).replace("T", " ") }).where(eq(schema.memberships.id, membershipId));
}
