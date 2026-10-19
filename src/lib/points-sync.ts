/**
 * The points sync and the invitations on the coach's own program (H-867 parts 3 and 4; H-890, H-898). Off until the coach
 * switches it on, and "own" before "all", so the coach's own pass is always first.
 *
 * - Points: a member's first sync is one opening move of their HelixOS total; after that every new ledger row is one move,
 *   keyed to that row, so nothing is ever sent twice. The moves go out through the points outbox (same queue, pause and
 *   events check). The opening move and the rows it covers are written in one transaction.
 * - Level: the member's program goes to the pass's Level field when it changes.
 * - Tier: the member's kept rank (H-1088, H-1098) goes to the pass's Tier field when it changes, so the pass shows the same
 *   rank as HelixOS and never a lower one. eLoyalty's "Points Earned Check Tier" automation is paused for this program.
 * - Invitations: when a member earns one (inviteDue) and the rung has a booking link, Current_Offer and Offer_Link are
 *   written once. With no link, nothing is written.
 * - Never the Points field: points move only as adds and deducts.
 *
 * Logs carry counts and causes only: never a name, an email, a key or an id.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { address } from "@/lib/engine/eloyalty";
import { tagFor, taggedReason } from "@/lib/engine/points-outbox";
import { INVITES, type InviteKey, inviteDue, levelFor, modeReaches, syncReason, tierWords } from "@/lib/engine/points-sync";
import { allPaused } from "@/lib/points-outbox";
import { recordRateLimit } from "@/lib/loyalty-rate";

const PACE_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One PUT of a pass field with the program's key; the status, or 0 when nothing came back. */
export async function putField(host: string, key: string, path: string, body: unknown): Promise<number> {
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}${path}`, { method: "PUT", headers: { authorization: `Bearer ${key}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    await res.text();
    return res.status;
  } catch {
    return 0;
  }
}

export type SyncResult = { feed: string; members: number; queued: number; fields: number; failed: number; busy: boolean; skipped?: string };

type Member = Pick<schema.Membership, "id" | "userId" | "role" | "programTier" | "eoCustomerId" | "eoPassSerial" | "eoPassTypeId" | "eoLevelSent" | "eoTierSent" | "rankKeptLevel" | "eoOffersSent">;

/** Queue this member's moves: the opening move on their first sync, then one per new ledger row. Returns how many were queued. */
export async function queueMemberMoves(feed: schema.LeaderboardFeed, m: Member): Promise<number> {
  const customerId = m.eoCustomerId!;
  const rows = await db.query.pointsLedger.findMany({
    where: and(eq(schema.pointsLedger.workspaceId, feed.workspaceId), eq(schema.pointsLedger.userId, m.userId), eq(schema.pointsLedger.eoMirrored, false)),
    columns: { id: true, points: true, type: true },
  });
  if (!rows.length) return 0;
  const openingSource = `sync-open:${m.id}`;
  const opened = await db.query.loyaltyPointsMoves.findFirst({ where: eq(schema.loyaltyPointsMoves.source, openingSource), columns: { id: true } });
  const move = (source: string, delta: number, reason: string) => {
    const id = newId();
    return { id, feedId: feed.id, workspaceId: feed.workspaceId, customerId, delta: Math.round(delta), reason: taggedReason(reason, tagFor(id)), source, byUserId: m.userId, nextTryAt: nowIso() };
  };
  let queued = 0;
  await db.transaction(async (tx) => {
    if (!opened) {
      const total = rows.reduce((n, r) => n + r.points, 0);
      if (total) {
        await tx.insert(schema.loyaltyPointsMoves).values(move(openingSource, total, syncReason("opening"))).onConflictDoNothing();
        queued++;
      } else {
        // A zero opening still marks the start, so later rows are sent one by one.
        await tx.insert(schema.loyaltyPointsMoves).values({ ...move(openingSource, 0, syncReason("opening")), status: "sent", sentAt: nowIso(), lastNote: "nothing to send" }).onConflictDoNothing();
      }
    } else {
      for (const r of rows) {
        if (!r.points) continue;
        await tx.insert(schema.loyaltyPointsMoves).values(move(`sync-row:${r.id}`, r.points, syncReason("row", r.type))).onConflictDoNothing();
        queued++;
      }
    }
    await tx.update(schema.pointsLedger).set({ eoMirrored: true }).where(inArray(schema.pointsLedger.id, rows.map((r) => r.id)));
  });
  return queued;
}

/** The sync for one program: only the coach's own, only with a passed check, and only the members its modes reach. */
export async function syncFeed(feed: schema.LeaderboardFeed, now = new Date()): Promise<SyncResult> {
  const out: SyncResult = { feed: feed.slug, members: 0, queued: 0, fields: 0, failed: 0, busy: false };
  if (feed.syncMode === "off" && feed.inviteMode === "off") return { ...out, skipped: "off" };
  const owner = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, feed.membershipId), columns: { role: true } });
  if (owner?.role !== "coach") return { ...out, skipped: "not the coach's own program" };
  if (!feed.lastCheckOk) return { ...out, skipped: "check not passed" };
  if (feed.movesPaused || allPaused()) return { ...out, skipped: "paused" };
  if (feed.refreshAfter && Date.parse(feed.refreshAfter) > now.getTime()) return { ...out, skipped: "waiting after a 429" };
  const key = open(feed.keyEncrypted);
  if (!key) return { ...out, skipped: "no key" };
  const members = (await db.query.memberships.findMany({
    where: and(eq(schema.memberships.workspaceId, feed.workspaceId), isNotNull(schema.memberships.eoCustomerId), inArray(schema.memberships.role, ["coach", "client"])),
    columns: { id: true, userId: true, role: true, programTier: true, eoCustomerId: true, eoPassSerial: true, eoPassTypeId: true, eoLevelSent: true, eoTierSent: true, rankKeptLevel: true, eoOffersSent: true },
  })) as Member[];
  for (const m of members) {
    const isCoach = m.role === "coach";
    const syncs = modeReaches(feed.syncMode, isCoach);
    const invites = modeReaches(feed.inviteMode, isCoach);
    if (!syncs && !invites) continue;
    out.members++;
    if (syncs) out.queued += await queueMemberMoves(feed, m);
    const pass = { passTypeId: m.eoPassTypeId, serial: m.eoPassSerial };
    if (!pass.passTypeId || !pass.serial) continue;
    // Level, when it changed.
    const level = levelFor(m.role, m.programTier);
    if (syncs && m.eoLevelSent !== level) {
      const a = address("passField", pass, { field: "Level", value: level });
      const status = a.ok ? await putField(feed.host, key, a.path, a.body) : -1;
      if (status === 429) {
        out.busy = true;
        break;
      }
      if (status >= 200 && status < 300) {
        await db.update(schema.memberships).set({ eoLevelSent: level }).where(eq(schema.memberships.id, m.id));
        out.fields++;
      } else out.failed++;
      await sleep(PACE_MS);
    }
    const points = (await db.select({ total: schema.pointsLedger.points }).from(schema.pointsLedger).where(and(eq(schema.pointsLedger.workspaceId, feed.workspaceId), eq(schema.pointsLedger.userId, m.userId)))).reduce((n, r) => n + r.total, 0);
    // Tier: the kept rank by name, when it changed (H-1098). Never lower than the highest reached.
    const tier = tierWords(points, m.rankKeptLevel);
    if (syncs && m.eoTierSent !== tier) {
      const a = address("passField", pass, { field: "Tier", value: tier });
      const status = a.ok ? await putField(feed.host, key, a.path, a.body) : -1;
      if (status === 429) {
        out.busy = true;
        break;
      }
      if (status >= 200 && status < 300) {
        await db.update(schema.memberships).set({ eoTierSent: tier }).where(eq(schema.memberships.id, m.id));
        out.fields++;
      } else out.failed++;
      await sleep(PACE_MS);
    }
    // The invitation, once, with its link.
    if (invites) {
      const due = inviteDue({ role: m.role, programTier: m.programTier, points, rankKeptLevel: m.rankKeptLevel, sent: m.eoOffersSent });
      const link = due ? feed.inviteLinks[due] : undefined;
      if (due && link) {
        const sent = await writeInvite(feed, key, pass, due, link);
        if (sent === "busy") {
          out.busy = true;
          break;
        }
        if (sent === "ok") {
          await db.update(schema.memberships).set({ eoOffersSent: [...m.eoOffersSent, due] }).where(eq(schema.memberships.id, m.id));
          out.fields += 2;
        } else out.failed++;
      }
    }
  }
  if (out.busy) await recordRateLimit(feed.id, now);
  if (out.queued || out.fields || out.failed || out.busy) console.log(`[points-sync] ${feed.slug}: ${out.members} members, ${out.queued} moves queued, ${out.fields} fields written, ${out.failed} failed${out.busy ? ", stopped at a 429" : ""}`);
  return out;
}

/** The link first, then the text: the text's change message is what notifies, so it goes last, once the link is there. */
async function writeInvite(feed: schema.LeaderboardFeed, key: string, pass: { passTypeId: string | null; serial: string | null }, due: InviteKey, link: string): Promise<"ok" | "busy" | "failed"> {
  for (const [field, value] of [["Offer_Link", link], ["Current_Offer", INVITES[due].text]] as const) {
    const a = address("passField", pass, { field, value });
    const status = a.ok ? await putField(feed.host, key, a.path, a.body) : -1;
    if (status === 429) return "busy";
    if (status < 200 || status >= 300) return "failed";
    await sleep(PACE_MS);
  }
  return "ok";
}

/** The cron's pass: every program with a sync or an invitation mode on. */
export async function syncAll(now = new Date()): Promise<SyncResult[]> {
  const feeds = await db.query.leaderboardFeeds.findMany({ where: isNotNull(schema.leaderboardFeeds.keyEncrypted) });
  const out: SyncResult[] = [];
  for (const f of feeds) if (f.syncMode !== "off" || f.inviteMode !== "off") out.push(await syncFeed(f, now));
  return out;
}
