/**
 * The Colosseum's data (rev 699, rev 720): one arena for a coach's workspace, read from what HelixOS already has. Points are
 * the Rewards ledger's (all-time, and since Monday in the member's zone); ranks are the Rewards tiers; wins are the ones
 * members share here; My week is the member's own. Hidden members are out of the arena and the standings. No health or body
 * data, no emails, no phone numbers leave here: a standing carries a name, a rank and numbers. Each viewer's blocks (H-745) are
 * applied here, through the rules in src/lib/engine/blocks.ts: a blocked member's wins are gone, their seat reads "A member".
 */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { champions, initials, readWin, seatRings, standings, weekByDay, type RingSeat, type Standing, type WinKind } from "@/lib/engine/colosseum";
import { tierFor, tierProgress } from "@/lib/engine/tiers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { leaderboard } from "@/lib/queries/points";
import { shortName, veil, visibleWins, type BlockSet } from "@/lib/engine/blocks";
import { WIN_REFUSED } from "@/lib/engine/word-filter";

export { shortName };

type Member = { workspaceId: string; userId: string };

/** The Monday (YYYY-MM-DD) of the week that holds `today` (YYYY-MM-DD). */
export function mondayOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

export type ArenaSeat = { id: string; name: string; initials: string; tier: string; points: number; week: number; photo: boolean; membershipId: string; isYou: boolean; champ: number; coach: boolean; veiled: boolean };
/** A win on the feed; `authorId` is the author's membership id (empty once they've left), for Block and Report. */
export type ArenaWin = { id: string; who: string; kind: WinKind; text: string; at: string; mine: boolean; authorId: string; coach: boolean };
export type Arena = {
  on: boolean;
  rows: Standing[];
  champs: Standing[];
  rings: RingSeat[][];
  more: number[];
  you: { standing: Standing | null; tier: string; points: number; week: number; toNext: number; nextTier: string | null; hidden: boolean; photo: boolean; paused: boolean };
  wins: ArenaWin[];
  week: { days: { day: string; points: number }[]; total: number; wins: ArenaWin[]; biggest: string | null; monday: string };
};

/**
 * Everything the page shows for one viewer: the workspace's standings, the arena's seats, the feed, and the viewer's own week,
 * with the viewer's blocks (blockedFor, src/lib/blocks.ts) applied. A win the coach hid is out for everyone.
 */
export async function arenaFor(v: { workspace: { id: string; colosseumOn: boolean }; user: { id: string }; membership: { id: string; arenaHidden: boolean; arenaPhoto: boolean; arenaPaused: boolean } }, today: string, blocks: BlockSet): Promise<Arena> {
  const monday = mondayOf(today);
  const [members, all, week, winRows] = await Promise.all([
    db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), isNull(schema.memberships.removedAt)), columns: { id: true, userId: true, role: true, arenaHidden: true, arenaPhoto: true, headshotUrl: true, headshotSource: true } }),
    leaderboard(v.workspace.id),
    leaderboard(v.workspace.id, `${monday} 00:00:00`),
    db.query.colosseumWins.findMany({ where: and(eq(schema.colosseumWins.workspaceId, v.workspace.id), isNull(schema.colosseumWins.hiddenAt)), orderBy: desc(schema.colosseumWins.createdAt), limit: 60 }),
  ]);
  const users = members.length ? await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)), columns: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const total = new Map(all.map((r) => [r.userId, Number(r.total)]));
  const wk = new Map(week.map((r) => [r.userId, Number(r.total)]));
  const rows: Standing[] = members
    .filter((m) => m.role === "client" || m.role === "coach")
    .map((m) => {
      const points = total.get(m.userId) ?? 0;
      return veil({ userId: m.userId, membershipId: m.id, name: nameOf.get(m.userId) ?? "Member", points, week: wk.get(m.userId) ?? 0, tier: tierFor(points).name, hidden: m.arenaHidden, photo: m.arenaPhoto && Boolean(m.headshotUrl) && m.headshotSource !== "removed", isYou: m.userId === v.user.id, coach: m.role === "coach" }, blocks);
    });
  const champs = champions(rows);
  const { rings, more } = seatRings(rows, champs);
  const mine = rows.find((r) => r.isYou) ?? null;
  const myPoints = mine?.points ?? total.get(v.user.id) ?? 0;
  const progress = tierProgress(myPoints);
  const memberOf = new Map(members.map((m) => [m.userId, m]));
  const wins: ArenaWin[] = visibleWins(winRows, blocks).map((w) => ({ id: w.id, who: shortName(nameOf.get(w.userId) ?? "Member"), kind: w.kind, text: w.text, at: w.createdAt, mine: w.userId === v.user.id, authorId: memberOf.get(w.userId)?.id ?? "", coach: memberOf.get(w.userId)?.role === "coach" }));
  // My week: the ledger by day since Monday, my shared wins this week, and the biggest win from my own close-outs.
  const [ledger, closes] = await Promise.all([
    db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.workspaceId, v.workspace.id), eq(schema.pointsLedger.userId, v.user.id), gte(schema.pointsLedger.createdAt, `${monday} 00:00:00`)), columns: { points: true, createdAt: true } }),
    db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.workspaceId, v.workspace.id), eq(schema.dailyLogs.userId, v.user.id), gte(schema.dailyLogs.date, monday)), columns: { date: true, win: true }, orderBy: desc(schema.dailyLogs.date) }),
  ]);
  const days = weekByDay(ledger.map((r) => ({ points: r.points, day: r.createdAt.slice(0, 10) })), monday);
  return {
    on: v.workspace.colosseumOn,
    rows,
    champs,
    rings,
    more,
    you: { standing: mine, tier: progress.current.name, points: myPoints, week: mine?.week ?? wk.get(v.user.id) ?? 0, toNext: progress.toNext, nextTier: progress.next?.name ?? null, hidden: v.membership.arenaHidden, photo: v.membership.arenaPhoto, paused: v.membership.arenaPaused },
    wins,
    week: { days, total: days.reduce((n, d) => n + d.points, 0), wins: wins.filter((w) => w.mine && w.at.slice(0, 10) >= monday), biggest: closes.map((c) => c.win?.trim()).find(Boolean) ?? null, monday },
  };
}

/** The seats the arena draws: initials or the member's opted-in photo, never an email or anything from HumanOS. */
export function seatsOf(a: Arena): { rings: (ArenaSeat & { ring: number; index: number; of: number })[][]; champs: ArenaSeat[] } {
  const seat = (s: Standing, champ = 0): ArenaSeat => ({ id: s.userId, name: shortName(s.name), initials: s.veiled ? "?" : initials(s.name), tier: s.tier, points: s.points, week: s.week, photo: s.photo, membershipId: s.membershipId, isYou: s.isYou, champ, coach: Boolean(s.coach), veiled: Boolean(s.veiled) });
  return { rings: a.rings.map((ring) => ring.map((r) => ({ ...seat(r.seat), ring: r.ring, index: r.index, of: r.of }))), champs: a.champs.map((c, i) => seat(c, i + 1)) };
}

export const standingsOf = (a: Arena, tier: string | null) => standings(a.rows, tier);

/** A win shared on the page, in the member's own words, after the plain-text check. */
export async function shareWin(m: Member, kind: unknown, text: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = readWin(kind, text);
  if (!r.ok) {
    // The cause only: never the member's words.
    if (r.error === WIN_REFUSED) console.info("[colosseum] a win was held back by the word filter");
    return r;
  }
  await db.insert(schema.colosseumWins).values({ id: newId(), ...m, kind: r.kind, text: r.text, createdAt: nowIso() });
  return { ok: true };
}

/** A member's own win comes down again; nobody else's. */
export async function removeWin(m: Member, id: string): Promise<void> {
  await db.delete(schema.colosseumWins).where(and(eq(schema.colosseumWins.workspaceId, m.workspaceId), eq(schema.colosseumWins.userId, m.userId), eq(schema.colosseumWins.id, id)));
}
