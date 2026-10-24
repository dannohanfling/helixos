import { and, asc, eq, isNotNull, isNull, like, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { TEST_KEY_PREFIX, testSeries, type PushType } from "@/lib/engine/push";
import { liveTransport, type Transport } from "@/lib/push/send";

/**
 * A coach's test series (H-1967, Approve H-1968): ten pushes to their own phones, one of each type, 3 minutes apart, so the
 * app can be tested closed. Queued as push_sends rows keyed "test:<series>:<n>" with sentAt the time each is due and
 * delivered -1 until the 1-minute cron (/api/cron/push-test) sends it; sentToday() skips these keys, so they never touch a
 * member's cap. No new table. Logs carry counts only.
 */
const QUEUED = -1;

export type SeriesState = { total: number; sent: number; nextAt: string | null };

/** Starts a series (replacing any still running) and sends the first one now. */
export async function startTestSeries(m: { id: string; userId: string }, now: Date = new Date(), transport: Transport = liveTransport): Promise<SeriesState> {
  await stopTestSeries(m.id);
  const series = newId();
  const rows = testSeries(now).map((t, i) => ({
    id: newId(),
    membershipId: m.id,
    userId: m.userId,
    type: t.type,
    key: `${TEST_KEY_PREFIX}${series}:${i}`,
    sentAt: t.dueAt.toISOString(),
    delivered: QUEUED,
  }));
  await db.insert(schema.pushSends).values(rows);
  await runTestSeries(now, transport);
  return seriesState(m.id);
}

/** Cancels whatever is still queued for this member. Sent ones stay, as ordinary history. */
export async function stopTestSeries(membershipId: string): Promise<void> {
  await db.delete(schema.pushSends).where(and(eq(schema.pushSends.membershipId, membershipId), like(schema.pushSends.key, `${TEST_KEY_PREFIX}%`), eq(schema.pushSends.delivered, QUEUED)));
}

/** Where this member's latest series stands: how many sent of how many, and when the next is due. Null if none queued. */
export async function seriesState(membershipId: string): Promise<SeriesState> {
  const rows = await db.query.pushSends.findMany({
    where: and(eq(schema.pushSends.membershipId, membershipId), like(schema.pushSends.key, `${TEST_KEY_PREFIX}%`)),
    orderBy: asc(schema.pushSends.sentAt),
  });
  const latest = rows.length ? rows[rows.length - 1].key.split(":")[1] : null;
  const mine = rows.filter((r) => r.key.split(":")[1] === latest);
  const queued = mine.filter((r) => r.delivered === QUEUED);
  return { total: mine.length, sent: mine.length - queued.length, nextAt: queued[0]?.sentAt ?? null };
}

/** The cron: sends every queued test push that is due, to that member's own phones with a token. */
export async function runTestSeries(now: Date = new Date(), transport: Transport = liveTransport): Promise<{ sent: number; held: number }> {
  const due = await db.query.pushSends.findMany({
    where: and(like(schema.pushSends.key, `${TEST_KEY_PREFIX}%`), eq(schema.pushSends.delivered, QUEUED), lte(schema.pushSends.sentAt, now.toISOString())),
    orderBy: asc(schema.pushSends.sentAt),
  });
  let sent = 0;
  let held = 0;
  for (const row of due) {
    // Claim it first, so two cron runs at once can't both send it.
    const claimed = await db
      .update(schema.pushSends)
      .set({ delivered: 0 })
      .where(and(eq(schema.pushSends.id, row.id), eq(schema.pushSends.delivered, QUEUED)))
      .returning({ id: schema.pushSends.id });
    if (!claimed.length) continue;
    const item = testSeries(new Date(row.sentAt)).find((t) => t.type === (row.type as PushType));
    if (!item) continue;
    const devices = await db.query.pushDevices.findMany({
      where: and(eq(schema.pushDevices.membershipId, row.membershipId), isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)),
    });
    let delivered = 0;
    for (const d of devices) {
      const r = await (d.platform === "ios" ? transport.ios : transport.android)(d.token!, { title: item.title, body: item.body, path: item.path }).catch(() => ({
        ok: false as const,
        gone: false,
        reason: "send failed",
      }));
      if (r.ok) delivered++;
      else console.warn(`[push-test] ${row.type} to a ${d.platform} device failed: ${r.reason}`);
    }
    await db.update(schema.pushSends).set({ delivered, sentAt: now.toISOString() }).where(eq(schema.pushSends.id, row.id));
    if (delivered) sent++;
    else held++;
  }
  return { sent, held };
}
