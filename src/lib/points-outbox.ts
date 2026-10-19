/**
 * The points outbox on the server (H-404, H-493): queue a Kindness Koins move on a client's eLoyalty program, send it as an
 * add or a deduct by customer id with the feed's own sealed key, settle a lost answer from the customer's events before any
 * resend, wait a minute after a 429, and hold everything while the coach's pause is on. The pure rules are in
 * src/lib/engine/points-outbox.ts. Logs carry counts, statuses and times only: never a key, a reason, a name or an id.
 */
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { address } from "@/lib/engine/eloyalty";
import { type BoardRow } from "@/lib/engine/leaderboard";
import { type Balance, afterEventsRead, afterSend, checkVerdict, eventsHaveTag, patchRows, readAnswer, readBalance, tagFor, taggedReason } from "@/lib/engine/points-outbox";
import { getJson, statusWords } from "@/lib/leaderboard";
import { recordRateLimit } from "@/lib/loyalty-rate";

/** A short pause between sends, as the points check paces its reads. */
export const PACE_MS = 150;
/** The most moves one drain sends for a feed. */
export const DRAIN_LIMIT = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every move for every program waits while this is set in the environment: the switch for all of them at once. */
export const allPaused = () => process.env.KK_MOVES_PAUSED === "1";

/** One POST to eLoyalty with the program's key; the status and the parsed answer, or status 0 when nothing came back. */
export async function postJson(host: string, key: string, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

export type QueueInput = { customerId: string; delta: number; reason: string; source: string; byUserId: string };

/** Queue one move. The source is unique: queueing the same press twice returns the move already there, never a second one. */
export async function queueMove(feed: schema.LeaderboardFeed, m: QueueInput): Promise<schema.LoyaltyPointsMove> {
  const id = newId();
  await db
    .insert(schema.loyaltyPointsMoves)
    .values({ id, feedId: feed.id, workspaceId: feed.workspaceId, customerId: m.customerId, delta: Math.round(m.delta), reason: taggedReason(m.reason, tagFor(id)), source: m.source, byUserId: m.byUserId, nextTryAt: nowIso() })
    .onConflictDoNothing();
  return (await db.query.loyaltyPointsMoves.findFirst({ where: eq(schema.loyaltyPointsMoves.source, m.source) }))!;
}

const tagOf = (reason: string) => /\[(HX-[0-9a-z]+)\]$/i.exec(reason)?.[1] ?? "";

/** Send one move (or, when its last answer was lost, look for it in the events first). Returns the move as it now stands. */
export async function sendMove(feed: schema.LeaderboardFeed, key: string, move: schema.LoyaltyPointsMove, now = new Date()): Promise<schema.LoyaltyPointsMove> {
  const set = async (patch: Partial<schema.LoyaltyPointsMove>) => {
    await db.update(schema.loyaltyPointsMoves).set(patch).where(eq(schema.loyaltyPointsMoves.id, move.id));
    return (await db.query.loyaltyPointsMoves.findFirst({ where: eq(schema.loyaltyPointsMoves.id, move.id) }))!;
  };
  if (move.checkFirst) {
    const ev = address("customerEvents", { customerId: move.customerId });
    if (!ev.ok) return set({ status: "failed", lastNote: "no customer id" });
    const got = await getJson(feed.host, key, `${ev.path}?limit=50`);
    if (got.status < 200 || got.status >= 300) return set({ nextTryAt: new Date(now.getTime() + 60_000).toISOString(), lastStatus: got.status, lastNote: `${statusWords(got.status)} reading its events; looked for again in a minute` });
    const settled = afterEventsRead(eventsHaveTag(got.json, tagOf(move.reason)), now);
    move = await set(settled);
    if (move.status === "sent") return move;
  }
  const a = address(move.delta > 0 ? "pointsAdd" : "pointsDeduct", { customerId: move.customerId }, { points: move.delta, reason: move.reason });
  if (!a.ok) return set({ status: "failed", lastNote: "no customer id" });
  const r = await postJson(feed.host, key, a.path, a.body);
  const answer = readAnswer(r.status, r.json);
  const patch = afterSend(move, r.status, answer, now);
  const after = await set(patch);
  if (after.status === "sent") await patchHeldBoard(feed.id, move.customerId, move.delta, after.newBalance);
  return after;
}

/** The held board learns the move at once, so the page shows it before the next refresh reads eLoyalty again. */
async function patchHeldBoard(feedId: string, customerId: string, delta: number, newBalance: number | null): Promise<void> {
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedId) });
  if (!feed?.cacheJson) return;
  let rows: BoardRow[] = [];
  try {
    rows = JSON.parse(feed.cacheJson) as BoardRow[];
  } catch {
    return;
  }
  await db.update(schema.leaderboardFeeds).set({ cacheJson: JSON.stringify(patchRows(rows, customerId, delta, newBalance)) }).where(eq(schema.leaderboardFeeds.id, feedId));
}

export type DrainResult = { feed: string; sent: number; failed: number; waiting: number; paused: boolean };

/** Send what is due for one feed, oldest first, a few at a time, paced. A paused feed sends nothing and keeps its queue. */
export async function drainFeed(feed: schema.LeaderboardFeed, now = new Date(), only?: string): Promise<DrainResult> {
  const out: DrainResult = { feed: feed.slug, sent: 0, failed: 0, waiting: 0, paused: feed.movesPaused || allPaused() };
  const due = await db.query.loyaltyPointsMoves.findMany({
    where: and(eq(schema.loyaltyPointsMoves.feedId, feed.id), eq(schema.loyaltyPointsMoves.status, "pending"), lte(schema.loyaltyPointsMoves.nextTryAt, now.toISOString()), ...(only ? [eq(schema.loyaltyPointsMoves.id, only)] : [])),
    orderBy: [asc(schema.loyaltyPointsMoves.createdAt)],
    limit: DRAIN_LIMIT,
  });
  const key = open(feed.keyEncrypted);
  if (out.paused || !key) {
    out.waiting = due.length;
    return out;
  }
  for (let i = 0; i < due.length; i++) {
    const after = await sendMove(feed, key, due[i], now);
    if (after.status === "sent") out.sent++;
    else if (after.status === "failed") out.failed++;
    else out.waiting++;
    if (after.lastStatus === 429) {
      await recordRateLimit(feed.id, now);
      break;
    }
    if (i + 1 < due.length) await sleep(PACE_MS);
  }
  if (out.sent || out.failed) console.log(`[points-outbox] ${feed.slug}: ${out.sent} sent, ${out.failed} failed, ${out.waiting} waiting`);
  return out;
}

/** The cron's pass: every feed with moves due. */
export async function drainAll(now = new Date()): Promise<DrainResult[]> {
  const pending = await db.selectDistinct({ feedId: schema.loyaltyPointsMoves.feedId }).from(schema.loyaltyPointsMoves).where(and(eq(schema.loyaltyPointsMoves.status, "pending"), lte(schema.loyaltyPointsMoves.nextTryAt, now.toISOString())));
  const results: DrainResult[] = [];
  for (const { feedId } of pending) {
    const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedId) });
    if (feed) results.push(await drainFeed(feed, now));
  }
  return results;
}

/** The latest moves on a feed, newest first, for the desk and the coach row. */
export const recentMoves = (feedId: string, limit = 15) => db.query.loyaltyPointsMoves.findMany({ where: eq(schema.loyaltyPointsMoves.feedId, feedId), orderBy: [desc(schema.loyaltyPointsMoves.createdAt)], limit });

/** One customer's balance and lifetime, read from eLoyalty now (GET only), or null. */
export async function liveBalance(feed: schema.LeaderboardFeed, key: string, customerId: string): Promise<Balance> {
  const a = address("customer", { customerId });
  if (!a.ok) return null;
  const got = await getJson(feed.host, key, a.path);
  return got.status >= 200 && got.status < 300 ? readBalance(got.json) : null;
}

/** A check move with no clear answer is closed, never left for the cron to send later: the coach looks at the test pass instead. */
async function closeCheckMove(m: schema.LoyaltyPointsMove): Promise<void> {
  if (m.status !== "pending") return;
  await db.update(schema.loyaltyPointsMoves).set({ status: "failed", lastNote: `${m.lastNote ?? "no clear answer"}; the check stopped here, so look at the test pass in eLoyalty` }).where(eq(schema.loyaltyPointsMoves.id, m.id));
}

/**
 * The one add-and-deduct check (H-493 step 4), on a pass from the client's hide list (a team test), or on the coach's own
 * program the coach's own pass (H-734 step E): 1 deducted, read back,
 * 1 added back, read back. Both moves go through the outbox like any other. The result is kept on the feed in words and
 * numbers; the desk opens only once it has passed.
 */
export async function runDeskCheck(feed: schema.LeaderboardFeed, customerId: string, byUserId: string, now = new Date(), opts: { ownCustomerId?: string | null } = {}): Promise<{ ok: boolean; note: string }> {
  const done = async (ok: boolean, note: string) => {
    await db.update(schema.leaderboardFeeds).set({ deskCheckAt: nowIso(), deskCheckOk: ok, deskCheckNote: note, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
    return { ok, note };
  };
  // On the coach's own program (H-734 step E) the coach's own pass may be checked without hiding it from the board.
  const own = Boolean(opts.ownCustomerId && customerId === opts.ownCustomerId);
  if (!own && !feed.hidden.includes(customerId)) return done(false, "The check runs only on a pass from the hide list (a team test) or your own pass, never on a member.");
  if (feed.movesPaused || allPaused()) return done(false, "Moves are paused, so the check did not run.");
  const key = open(feed.keyEncrypted);
  if (!key) return done(false, "No eLoyalty key is saved on this row.");
  const stamp = now.toISOString();
  const before = await liveBalance(feed, key, customerId);
  if (before && before.balance < 1) return done(false, own ? "Your pass has 0 available, so there is nothing to deduct. Turn on the sync for your own pass first (it sends your HelixOS points), or add 1 to it in eLoyalty." : "That test pass has 0 available, so there is nothing to deduct. Pick another, or add 1 to it in eLoyalty first.");
  const d = await queueMove(feed, { customerId, delta: -1, reason: "HelixOS desk check: deduct 1", source: `check:${feed.id}:${stamp}:deduct`, byUserId });
  const deduct = d.status === "pending" ? await sendMove(feed, key, d, now) : d;
  const afterDeduct = await liveBalance(feed, key, customerId);
  if (deduct.status !== "sent") {
    await closeCheckMove(deduct);
    return done(false, checkVerdict(before, deduct, afterDeduct, { status: "not tried", newBalance: null }, null).note + (deduct.lastNote ? ` (${deduct.lastNote})` : ""));
  }
  const a = await queueMove(feed, { customerId, delta: 1, reason: "HelixOS desk check: add the 1 back", source: `check:${feed.id}:${stamp}:add`, byUserId });
  const add = a.status === "pending" ? await sendMove(feed, key, a, now) : a;
  const afterAdd = await liveBalance(feed, key, customerId);
  if (add.status !== "sent") await closeCheckMove(add);
  const v = checkVerdict(before, deduct, afterDeduct, add, afterAdd);
  console.log(`[points-outbox] desk check on ${feed.slug}: ${v.ok ? "passed" : "did not pass"} (deduct ${deduct.lastStatus}, add ${add.lastStatus})`);
  return done(v.ok, v.note);
}
