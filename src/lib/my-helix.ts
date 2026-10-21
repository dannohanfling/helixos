/**
 * My Helix's data (rev 707, rev 710): the rung list from the helix_rungs table (seeded from rungs.json, the coach's to edit),
 * the member's facts gathered once from what HelixOS already holds, and their ticks. Every "done" is the engine's reading of
 * those facts; nothing here guesses.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { sectionFilled, type EssenceData } from "@/lib/engine/essence";
import { reframesOf } from "@/lib/engine/objections";
import { assetsFor } from "@/lib/queries/library";
import { byPlace, helixRungs, longestRun, nextRung, PHASES, RUNGS, SIGNALS, stats, type HelixFacts, type HelixRung, type Phase, type RungDef } from "@/lib/engine/my-helix";
import { newId } from "@/lib/ids";

type Member = { workspaceId: string; userId: string };

/** The live rung list: the table when seeded, else the file. */
export async function rungDefs(): Promise<RungDef[]> {
  const rows = await db.query.helixRungs.findMany();
  if (!rows.length) return RUNGS;
  return rows.map((r) => ({ key: r.key, phase: r.phase, order: r.order, label: r.label, signal: r.signal, href: r.href })).sort(byPlace);
}

/** What HelixOS knows about one member, read once. */
export async function factsFor(m: Member): Promise<HelixFacts> {
  const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));
  const [essence, avatars, offers, ladders, logs, magnets, content, scripts, clients, botKeys, webinars, setups, ticks, objectionBank] = await Promise.all([
    db.query.essences.findFirst({ where: mine(schema.essences), columns: { data: true } }),
    db.query.avatars.findMany({ where: and(mine(schema.avatars), isNull(schema.avatars.archivedAt)), columns: { who: true, pains: true } }),
    db.query.offers.findMany({ where: mine(schema.offers), columns: { ladderTier: true, objectionAssetIds: true, status: true, promise: true, mechanismName: true, pathSteps: true, container: true, price: true, objTime: true, objMoney: true, objPartner: true, objTriedBefore: true, objDiy: true, pathwayId: true } }),
    db.query.ladders.findMany({ where: mine(schema.ladders), columns: { launchedAt: true, shippedAt: true } }),
    db.query.dailyLogs.findMany({ where: mine(schema.dailyLogs), columns: { date: true, posts: true, newLeads: true, dmsStarted: true, callsBooked: true, callsHeld: true, offersMade: true } }),
    db.query.leadMagnets.findMany({ where: mine(schema.leadMagnets), columns: { publishedAt: true } }),
    db.query.contentItems.findMany({ where: mine(schema.contentItems), columns: { status: true, postLink: true, postedAt: true } }),
    db.query.socratesScripts.findMany({ where: mine(schema.socratesScripts), columns: { id: true } }),
    db.query.clientRecords.findMany({ where: mine(schema.clientRecords), columns: { id: true } }),
    db.query.botKeys.findMany({ where: and(mine(schema.botKeys), isNull(schema.botKeys.revokedAt)), columns: { lastUsedAt: true } }),
    db.query.webinars.findMany({ where: mine(schema.webinars), columns: { id: true, title: true, promise: true, status: true, registrationUrl: true, showed: true, offersMade: true, debriefLeak: true, debriefFix: true, sales: true, revenue: true, isExample: true } }),
    db.query.mfSetups.findMany({ where: mine(schema.mfSetups), columns: { webinarId: true, live: true } }),
    db.query.helixTicks.findMany({ where: mine(schema.helixTicks), columns: { rungKey: true, reason: true } }),
    assetsFor(m.workspaceId, m.userId, "objection"),
  ]);
  const data = (essence?.data ?? {}) as EssenceData;
  const live = offers.filter((o) => o.status !== "retired");
  const has = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  const priced = live.filter((o) => (o.price ?? 0) > 0).length;
  const byPathway = new Map<string, number>();
  for (const o of live) if (o.pathwayId) byPathway.set(o.pathwayId, (byPathway.get(o.pathwayId) ?? 0) + 1);
  const sum = (k: "newLeads" | "dmsStarted" | "callsBooked" | "callsHeld" | "offersMade") => logs.reduce((n, l) => n + (l[k] ?? 0), 0);
  const real = webinars.filter((w) => !w.isExample);
  const liveSetups = new Set(setups.filter((s) => s.live).map((s) => s.webinarId));
  return {
    essence: Object.keys(data).filter((k) => sectionFilled(data, k)),
    avatars: avatars.filter((a) => has(a.who) && has(a.pains)).length,
    offers: {
      promise: live.some((o) => has(o.promise)),
      framework: live.some((o) => has(o.mechanismName) || (Array.isArray(o.pathSteps) && o.pathSteps.length > 0)),
      containerPrice: live.some((o) => has(o.container) && (o.price ?? 0) > 0),
      // Docket #5 (K.Y.): at least five objections answered, from the bank (linked records that carry a reframe) plus any of the
      // five older fixed boxes; the five fixed boxes alone still count. "Exactly the five boxes" left a nine-objection offer unticked.
      objections: live.some((o) => {
        const fixed = [o.objTime, o.objMoney, o.objPartner, o.objTriedBefore, o.objDiy].filter(has).length;
        const bank = objectionBank.filter((a) => (o.objectionAssetIds ?? []).includes(a.id) && reframesOf(a).length > 0).length;
        return fixed === 5 || fixed + bank >= 5;
      }),
      // The pathway's tiers, read from the offers' prices: a free one is the Freebie; one, two, three priced offers reach Starter, Core, Premium.
      // Docket #10 (H-195): a tier the member set on an offer counts first; the price-derived ladder still fills in the rest.
      tiers: [...new Set([...live.flatMap((o) => (o.ladderTier ? [o.ladderTier] : [])), ...(live.some((o) => (o.price ?? 0) === 0) ? ["freebie"] : []), ...(priced >= 1 ? ["starter"] : []), ...(priced >= 2 ? ["core"] : []), ...(priced >= 3 ? ["premium"] : [])])],
    },
    pathwayMax: Math.max(0, ...byPathway.values()),
    ladders: { launched: ladders.filter((l) => l.launchedAt).length, shipped: ladders.filter((l) => l.shippedAt).length },
    postStreak: longestRun(logs.filter((l) => (l.posts ?? 0) > 0).map((l) => l.date)),
    magnets: magnets.length,
    magnetsPublished: magnets.filter((x) => x.publishedAt).length,
    log: { newLeads: sum("newLeads"), dmsStarted: sum("dmsStarted"), callsBooked: sum("callsBooked"), callsHeld: sum("callsHeld"), offersMade: sum("offersMade") },
    content: { count: content.length, scheduled: content.filter((c) => c.status === "scheduled").length, posted: content.filter((c) => c.status === "posted" && (has(c.postLink) || c.postedAt)).length },
    scripts: scripts.length,
    clients: clients.length,
    botLive: botKeys.some((k) => k.lastUsedAt),
    webinar: {
      any: real.length > 0,
      named: real.some((w) => has(w.title) && has(w.promise)),
      registration: real.some((w) => has(w.registrationUrl) || liveSetups.has(w.id)),
      delivered: real.some((w) => w.status === "delivered" || (w.showed ?? 0) > 0),
      offers: real.some((w) => (w.offersMade ?? 0) > 0),
      debrief: real.some((w) => has(w.debriefLeak) || has(w.debriefFix)),
      sale: real.some((w) => (w.sales ?? 0) > 0 || (w.revenue ?? 0) > 0),
    },
    ticks: ticks.map((t) => t.rungKey),
    reasons: Object.fromEntries(ticks.filter((t) => t.reason).map((t) => [t.rungKey, t.reason!])),
  };
}

export type HelixPhase = Phase & { rungs: HelixRung[]; done: number };
export type Helix = { rungs: HelixRung[]; phases: HelixPhase[]; next: HelixRung | null; built: number; total: number; pct: number; paused: boolean; fresh: string[] };

/** Everything the page shows for one viewer. `fresh` are the rungs done since they last looked: each glows once. */
export async function helixFor(v: { workspace: { id: string }; user: { id: string }; membership: { helixPaused: boolean; helixSeen: string[] } }): Promise<Helix> {
  const [defs, facts] = await Promise.all([rungDefs(), factsFor({ workspaceId: v.workspace.id, userId: v.user.id })]);
  const rungs = helixRungs(defs, facts);
  const phases = PHASES.map((p) => {
    const own = rungs.filter((r) => r.phase === p.n);
    return { ...p, rungs: own, done: own.filter((r) => r.done).length };
  });
  const seen = new Set(v.membership.helixSeen ?? []);
  return { rungs, phases, next: nextRung(rungs), ...stats(rungs), paused: v.membership.helixPaused, fresh: rungs.filter((r) => r.done && !seen.has(r.key)).map((r) => r.key) };
}

/** A tick on a rung no signal covers; a signal rung's tick is stored but never counts. */
export async function tickRung(m: Member, key: string, on: boolean, byUserId: string, reason: string | null = null): Promise<void> {
  const defs = await rungDefs();
  if (!defs.some((r) => r.key === key)) return;
  const where = and(eq(schema.helixTicks.workspaceId, m.workspaceId), eq(schema.helixTicks.userId, m.userId), eq(schema.helixTicks.rungKey, key));
  if (!on) {
    await db.delete(schema.helixTicks).where(where);
    return;
  }
  if (await db.query.helixTicks.findFirst({ where })) return;
  await db.insert(schema.helixTicks).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, rungKey: key, byUserId, reason: reason?.trim().slice(0, 200) || null });
}

/** The rungs the member has now seen lit: the once-glow never repeats for these. */
export async function markSeen(membershipId: string, seen: string[], keys: string[]): Promise<void> {
  const next = [...new Set([...seen, ...keys])];
  if (next.length === seen.length) return;
  await db.update(schema.memberships).set({ helixSeen: next }).where(eq(schema.memberships.id, membershipId));
}

/** The coach's edit of one rung: label, order, link, and which signal it reads (from the engine's list). */
export async function saveRung(key: string, patch: { label: string; order: number; href: string; signal: string }): Promise<{ ok: true } | { error: string }> {
  const label = patch.label.trim().slice(0, 80);
  if (!label) return { error: "A rung needs a name." };
  const href = patch.href.trim().startsWith("/") ? patch.href.trim().slice(0, 200) : "/today";
  const signal = SIGNALS.some((s) => s.key === patch.signal) ? patch.signal : "tick";
  const order = Number.isFinite(patch.order) ? Math.max(1, Math.round(patch.order)) : 1;
  const row = await db.query.helixRungs.findFirst({ where: eq(schema.helixRungs.key, key) });
  if (!row) return { error: "That rung isn't on the list." };
  await db.update(schema.helixRungs).set({ label, href, signal, order, updatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") }).where(eq(schema.helixRungs.key, key));
  return { ok: true };
}
