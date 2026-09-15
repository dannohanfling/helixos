/**
 * The handoff of a finished comment ladder to the coach's Community Loyalty Rung Dripper. HelixOS is a caller: one POST to
 * the coach's inbound webhook, then a row that says "handed", never "posted" (HelixOS is not told when a rung lands).
 * The webhook URL is the credential: opened only here for the request in hand, never in a note, a log line or a page.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { formatDateTime, nowIso } from "@/lib/dates";
import { outcomesFor, type Now } from "@/lib/engine/channel-outcome";
import { redactSecrets } from "@/lib/engine/redact";
import { dripLock, dripPayload, estimateDripEnd, handoffReasons, scheduleAtProblem, type HandoffGate } from "@/lib/engine/rung-drip";
import { logSync } from "@/lib/integrations";

export type DripSetup = { on: boolean; userNs: string | null; url: string | null };

/** Whether the coach's Community Loyalty drip is set up: both values present. The URL is opened only when a call is made. */
export function dripSetup(m: Pick<schema.Membership, "clDripWebhookUrl" | "clUserNs">): DripSetup {
  return { on: Boolean(m.clDripWebhookUrl && m.clUserNs), userNs: m.clUserNs ?? null, url: m.clDripWebhookUrl ?? null };
}

export async function activeHandoff(userId: string, atIso = nowIso()) {
  const rows = await db.query.dripHandoffs.findMany({ where: eq(schema.dripHandoffs.userId, userId), orderBy: [desc(schema.dripHandoffs.expiresAt)], limit: 5 });
  return dripLock(rows, atIso);
}

export async function handoffFor(contentItemId: string) {
  return db.query.dripHandoffs.findFirst({ where: eq(schema.dripHandoffs.contentItemId, contentItemId), orderBy: [desc(schema.dripHandoffs.handedAt)] });
}

/** The gate, as sentences: empty means the button may be offered. */
export async function handoffGate(v: { user: { id: string }; membership: schema.Membership; tz: string; today: string }, item: schema.ContentItem, variants: schema.ContentVariant[], ladder: schema.Ladder | null, blockers: number, now: Now): Promise<{ reasons: string[]; gate: HandoffGate }> {
  const setup = dripSetup(v.membership);
  const outcomes = outcomesFor(variants.filter((x) => x.contentItemId === item.id), now);
  const published = (channel: string) => outcomes.some((o) => o.channel === channel && o.state === "published");
  const lock = await activeHandoff(v.user.id, now.iso);
  const gate: HandoffGate = {
    webhook: Boolean(setup.url),
    webhookHttps: process.env.NODE_ENV !== "production" || (open(setup.url) ?? "").startsWith("https://"),
    userNs: Boolean(setup.userNs),
    ladder: Boolean(ladder),
    rungs: ladder?.rungs.length ?? 0,
    blockers,
    fbPublished: published("fb_page"),
    igPublished: published("instagram"),
    lockedUntil: lock.active ? formatDateTime(lock.until, v.tz) : null,
    threadsWithPlanner: variants.some((x) => x.contentItemId === item.id && x.channel === "threads" && x.groupId === "" && ["scheduled", "in_progress", "accepted", "pending", "in_review"].includes(x.externalStatus ?? "")),
  };
  return { reasons: handoffReasons(gate), gate };
}

export type HandoffResult = { ok: true; handedAt: string } | { ok: false; reason: string };

/** Sends the ladder. The caller has run the gate; this runs it again beside the write, then posts once. */
export async function handOffLadder(v: { workspaceId: string; user: { id: string }; membership: schema.Membership; tz: string; today: string }, item: schema.ContentItem, variants: schema.ContentVariant[], ladder: schema.Ladder, blockers: number, now: Now, threadsAt: string | null): Promise<HandoffResult> {
  const { reasons } = await handoffGate(v, item, variants, ladder, blockers, now);
  if (reasons.length) return { ok: false, reason: reasons.join(" ") };
  const timeProblem = scheduleAtProblem(threadsAt, now.iso);
  if (timeProblem) return { ok: false, reason: timeProblem };
  const setup = dripSetup(v.membership);
  const url = open(setup.url);
  if (!url || !setup.userNs) return { ok: false, reason: "Community Loyalty isn't connected for comment ladders yet. Evolve Omega sets that up." };
  const rungs = ladder.rungs.map((r) => r.body);
  const payload = dripPayload({ userNs: setup.userNs, post: [item.hook, item.body].filter(Boolean).join("\n\n"), rungs, fbIgPublisher: "helixos", scheduleAt: threadsAt });
  let status = 0;
  let text = "";
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    status = res.status;
    text = (await res.text()).slice(0, 300);
  } catch (e) {
    const note = redactSecrets(e instanceof Error ? e.message : String(e));
    await logSync({ workspaceId: v.workspaceId, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "drip.handoff", payload: { contentItemId: item.id, ladderId: ladder.id, rungs: rungs.length }, status: "failed", note: `Couldn't reach Community Loyalty: ${note}` });
    return { ok: false, reason: "Community Loyalty didn't answer. Nothing was handed off; try again in a minute." };
  }
  const note = redactSecrets(`${status} ${text}`.trim());
  if (status < 200 || status >= 300) {
    await logSync({ workspaceId: v.workspaceId, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "drip.handoff", payload: { contentItemId: item.id, ladderId: ladder.id, rungs: rungs.length }, status: "failed", note });
    return { ok: false, reason: "Community Loyalty didn't accept the ladder. Nothing was handed off; the reason is in the sync log." };
  }
  const handedAt = nowIso();
  await db.insert(schema.dripHandoffs).values({ id: crypto.randomUUID(), workspaceId: v.workspaceId, userId: v.user.id, contentItemId: item.id, ladderId: ladder.id, handedAt, rungCount: rungs.length, threadsAt: threadsAt || null, expiresAt: estimateDripEnd(handedAt, rungs.length), note });
  await logSync({ workspaceId: v.workspaceId, userId: v.user.id, provider: "community_loyalty", direction: "out", event: "drip.handoff", payload: { contentItemId: item.id, ladderId: ladder.id, rungs: rungs.length, threadsAt: threadsAt || undefined }, status: "sent", note });
  return { ok: true, handedAt };
}

/** The most recent handoff for an item, for the row. */
export async function handoffRowFor(userId: string, contentItemId: string): Promise<{ handedAt: string } | null> {
  const h = await db.query.dripHandoffs.findFirst({ where: and(eq(schema.dripHandoffs.userId, userId), eq(schema.dripHandoffs.contentItemId, contentItemId)), orderBy: [desc(schema.dripHandoffs.handedAt)] });
  return h ? { handedAt: h.handedAt } : null;
}
