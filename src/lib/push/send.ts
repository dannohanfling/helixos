import { and, desc, eq, gte, isNotNull, isNull, lt, notLike } from "drizzle-orm";
import { db, schema } from "@/db";
import { hourInTz, nowIso, todayInTz, wallTimeToUtc } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { DEFAULT_PREFS, PUSH_PATH, TEST_KEY_PREFIX, mayPush, pushCopy, type Prefs, type PushType } from "@/lib/engine/push";
import { apnsConfigured, sendApns } from "@/lib/push/apns";
import { fcmConfigured, sendFcm } from "@/lib/push/fcm";

/**
 * One push to one member (H-877): checks their switches, the daily cap and quiet hours (src/lib/engine/push.ts), records it
 * once per (member, type, key), and sends to each of their phones with a token. A phone Apple or Google says is gone is
 * switched off. Logs carry counts and causes only, never a member's name or the words sent.
 */
export type Transport = {
  ios: (token: string, msg: { title: string; body: string; path: string }) => Promise<{ ok: true } | { ok: false; gone: boolean; reason: string }>;
  android: (token: string, msg: { title: string; body: string; path: string }) => Promise<{ ok: true } | { ok: false; gone: boolean; reason: string }>;
};

export const liveTransport: Transport = {
  ios: (t, m) => (apnsConfigured() ? sendApns(t, m) : Promise.resolve({ ok: false, gone: false, reason: "APNs not configured" })),
  android: (t, m) => (fcmConfigured() ? sendFcm(t, m) : Promise.resolve({ ok: false, gone: false, reason: "Firebase not configured" })),
};

export type Member = { id: string; userId: string; tz: string };
export type SendOutcome = { sent: boolean; why?: string; delivered: number };

export async function prefsFor(membershipId: string): Promise<Prefs> {
  const row = await db.query.pushPrefs.findFirst({ where: eq(schema.pushPrefs.membershipId, membershipId) });
  return row ? { enabled: row.enabled, types: row.types ?? {}, quietStart: row.quietStart, quietEnd: row.quietEnd } : DEFAULT_PREFS;
}

/** The types already sent to this member since their own local midnight. A coach's test series never counts (H-1967). */
export async function sentToday(m: Member, now: Date): Promise<PushType[]> {
  const since = wallTimeToUtc(`${todayInTz(m.tz, now)}T00:00`, m.tz) ?? new Date(now.getTime() - 86400000).toISOString();
  const rows = await db.query.pushSends.findMany({
    where: and(eq(schema.pushSends.membershipId, m.id), gte(schema.pushSends.sentAt, since), notLike(schema.pushSends.key, `${TEST_KEY_PREFIX}%`)),
  });
  return rows.map((r) => r.type as PushType);
}

export async function sendPush(
  m: Member,
  type: PushType,
  key: string,
  vars: Parameters<typeof pushCopy>[1] = {},
  opts: { now?: Date; transport?: Transport; force?: boolean } = {},
): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const devices = await db.query.pushDevices.findMany({
    where: and(eq(schema.pushDevices.membershipId, m.id), isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)),
    orderBy: desc(schema.pushDevices.lastSeenAt),
  });
  if (!devices.length) return { sent: false, why: "no phone with notifications on", delivered: 0 };
  if (!opts.force) {
    const gate = mayPush(type, hourInTz(m.tz, now), await prefsFor(m.id), await sentToday(m, now));
    if (!gate.ok) return { sent: false, why: gate.why, delivered: 0 };
  }
  // The row first: the unique (member, type, key) means a second cron run, or two at once, can never send the same one twice.
  const sendId = newId();
  try {
    await db.insert(schema.pushSends).values({ id: sendId, membershipId: m.id, userId: m.userId, type, key, sentAt: now.toISOString() });
  } catch {
    return { sent: false, why: "already sent", delivered: 0 };
  }
  const { title, body } = pushCopy(type, vars);
  const msg = { title, body, path: PUSH_PATH[type] };
  const transport = opts.transport ?? liveTransport;
  let delivered = 0;
  for (const d of devices) {
    const r = await (d.platform === "ios" ? transport.ios : transport.android)(d.token!, msg).catch(() => ({ ok: false as const, gone: false, reason: "send failed" }));
    if (r.ok) delivered++;
    else {
      if (r.gone) await db.update(schema.pushDevices).set({ disabledAt: nowIso() }).where(eq(schema.pushDevices.id, d.id));
      console.warn(`[push] ${type} to a ${d.platform} device failed: ${r.reason}${r.gone ? " (device switched off)" : ""}`);
    }
  }
  await db.update(schema.pushSends).set({ delivered }).where(eq(schema.pushSends.id, sendId));
  return { sent: delivered > 0, why: delivered ? undefined : "no phone took it", delivered };
}

/** Sends older than 30 days aren't needed for any cap: removed by the push cron. */
export async function pruneSends(now: Date = new Date()): Promise<void> {
  await db.delete(schema.pushSends).where(lt(schema.pushSends.sentAt, new Date(now.getTime() - 30 * 86400000).toISOString()));
}

/** How many of this member's phones can take a push right now. */
export async function countPushPhones(membershipId: string): Promise<number> {
  const devices = await db.query.pushDevices.findMany({
    where: and(eq(schema.pushDevices.membershipId, membershipId), isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)),
  });
  return devices.length;
}

/**
 * Settings → Notifications → Send me a test (H-767): one push to each of this member's phones, outside the caps and quiet
 * hours, and not recorded in push_sends (it isn't one of the ten).
 */
export async function sendTestPush(membershipId: string, transport: Transport = liveTransport): Promise<{ phones: number; delivered: number }> {
  const devices = await db.query.pushDevices.findMany({
    where: and(eq(schema.pushDevices.membershipId, membershipId), isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)),
  });
  const msg = { title: "HelixOS", body: "Notifications are on. This is how a HelixOS reminder looks.", path: "/settings/notifications" };
  let delivered = 0;
  for (const d of devices) {
    const r = await (d.platform === "ios" ? transport.ios : transport.android)(d.token!, msg).catch(() => ({ ok: false as const, gone: false, reason: "error" }));
    if (r.ok) delivered++;
    else if (r.gone) await db.update(schema.pushDevices).set({ disabledAt: nowIso() }).where(eq(schema.pushDevices.id, d.id));
  }
  return { phones: devices.length, delivered };
}
