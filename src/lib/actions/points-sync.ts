"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { INVITE_KEYS, type SyncMode, readInviteLink } from "@/lib/engine/points-sync";
import { redirect } from "next/navigation";
import { open } from "@/lib/crypto";
import { address } from "@/lib/engine/eloyalty";
import { type PassMessageOutcome, passMessageOutcome, readPassMessage } from "@/lib/engine/pass-message";
import { putField } from "@/lib/points-sync";
import { recordRateLimit } from "@/lib/loyalty-rate";

const MODES: readonly SyncMode[] = ["off", "own", "all"];
const modeOf = (v: string): SyncMode | null => (MODES.includes(v as SyncMode) ? (v as SyncMode) : null);

/** The coach's own program, connected and checked: the only feed the sync and the invitations ever run on. */
async function ownFeed(coach: { workspace: { id: string }; membership: { id: string } }) {
  return db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.membershipId, coach.membership.id), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
}
const ready = (f: schema.LeaderboardFeed) => Boolean(f.keyEncrypted && f.templateId && f.lastCheckOk);

/** "Sync points" (H-867 steps G and H): off, the coach's own pass only, or everyone with a pass. Coach only, never switched in. */
export async function setSyncModeAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await ownFeed(coach);
  const mode = modeOf(str(formData, "syncMode"));
  if (!feed || !mode) return;
  if (mode !== "off" && !ready(feed)) return;
  await db.update(schema.leaderboardFeeds).set({ syncMode: mode, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}

/** The invitations (H-867 step I): the mode and each rung's booking link (https only). Coach only, never switched in. */
export async function setInvitesAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await ownFeed(coach);
  const mode = modeOf(str(formData, "inviteMode"));
  if (!feed || !mode) return;
  if (mode !== "off" && !ready(feed)) return;
  const links: Partial<Record<(typeof INVITE_KEYS)[number], string>> = {};
  for (const k of INVITE_KEYS) {
    const read = readInviteLink(str(formData, `link_${k}`));
    if (!read.ok) return;
    if (read.value) links[k] = read.value;
  }
  await db.update(schema.leaderboardFeeds).set({ inviteMode: mode, inviteLinks: links, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}

/**
 * Step D (H-734): one Latest Message on the coach's own pass, written to its Push_Notification field with the program's
 * key. Coach only, never switched in, own feed only, and only when the coach presses Send. Nothing else is written.
 * The log carries the outcome and status only, never the message, a key or an id.
 */
export async function sendPassMessageAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const back = (code: PassMessageOutcome) => redirect(`/coach?passMessage=${code}#own-program`);
  if (coach.switchedInto) back("notready");
  const feed = await ownFeed(coach);
  if (!feed || !ready(feed) || (feed.refreshAfter && Date.parse(feed.refreshAfter) > Date.now())) back(feed && ready(feed) ? "busy" : "notready");
  const msg = readPassMessage(str(formData, "message"));
  if (!msg.ok) back("bad");
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coach.membership.id), columns: { id: true, eoPassSerial: true, eoPassTypeId: true } });
  const a = address("pushNotification", { serial: m?.eoPassSerial ?? null, passTypeId: m?.eoPassTypeId ?? null }, { value: msg.ok ? msg.value : "" });
  if (!a.ok) back("nopass");
  const key = open(feed!.keyEncrypted);
  if (!key) back("notready");
  const status = a.ok ? await putField(feed!.host, key!, a.path, a.body) : -1;
  const outcome = passMessageOutcome(status);
  if (outcome === "busy") await recordRateLimit(feed!.id);
  if (outcome === "sent") await db.update(schema.memberships).set({ eoPassLastPushAt: nowIso() }).where(eq(schema.memberships.id, coach.membership.id));
  console.log(`[pass-message] own pass: ${outcome} (status ${status})`);
  back(outcome);
}
