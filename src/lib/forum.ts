/**
 * The Forum (rev 765), the database side: one member's agents, their reports (from the connector, the webhook or the member),
 * "what needs you", the webhook secret (its hash only), the coach's seeded build team, and the composed state the page and
 * forum_read return. Every report path goes through `reportToForum`, so the connector and the webhook write the same events.
 * Reports are capped and scrubbed by the engine before anything here sees them; the log is pruned to 90 days as reports land.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { allow } from "@/lib/rate-limit";
import { heardFrom } from "@/lib/forum-watch";
import { BUILT_INS, cleanLine, composeForum, FORUM_FLOW_MS, FORUM_FLOWS_SHOWN, FORUM_KEEP_DAYS, FORUM_MAX, FORUM_REPORTS_PER_MINUTE, FORUM_SEED, forumNameKey, isBuiltIn, isForumPlot, parseForumReport, plotFor, type BuiltInEvent, type BuiltInKey, type ForumPlot, type ForumReport, type ForumState } from "@/lib/engine/forum";

export type ForumMember = { workspaceId: string; userId: string };
type Source = "connector" | "webhook" | "member" | "agent";

const mineAgents = (m: ForumMember) => and(eq(schema.forumAgents.workspaceId, m.workspaceId), eq(schema.forumAgents.userId, m.userId));
const mineSettings = (m: ForumMember) => and(eq(schema.forumSettings.workspaceId, m.workspaceId), eq(schema.forumSettings.userId, m.userId));

export async function forumSettingsFor(m: ForumMember): Promise<schema.ForumSettings> {
  const had = await db.query.forumSettings.findFirst({ where: mineSettings(m) });
  if (had) return had;
  await db.insert(schema.forumSettings).values({ id: newId(), ...m }).onConflictDoNothing();
  return (await db.query.forumSettings.findFirst({ where: mineSettings(m) }))!;
}

/** A coach's Forum starts with their build team (rev 765 §5), once: removing an agent never brings it back. */
export async function seedCoachForum(m: ForumMember): Promise<void> {
  const s = await forumSettingsFor(m);
  if (s.seededAt) return;
  const claimed = await db.update(schema.forumSettings).set({ seededAt: nowIso() }).where(and(eq(schema.forumSettings.id, s.id), isNull(schema.forumSettings.seededAt))).returning({ id: schema.forumSettings.id });
  if (!claimed.length) return;
  const have = await db.query.forumAgents.findMany({ where: mineAgents(m), columns: { nameKey: true, plotId: true } });
  const taken = new Set(have.map((a) => a.plotId).filter(Boolean) as string[]);
  for (const a of FORUM_SEED) {
    if (have.some((h) => h.nameKey === forumNameKey(a.name))) continue;
    const plotId = taken.has(a.plot) ? null : a.plot;
    if (plotId) taken.add(plotId);
    await db.insert(schema.forumAgents).values({ id: newId(), ...m, name: a.name, nameKey: forumNameKey(a.name), platform: a.platform, role: a.role, plotId, createdBy: "seed", confirmed: true }).onConflictDoNothing();
  }
}

/** The agent a report names, made when the name is new (flagged "new" until the member confirms it). */
async function agentByName(m: ForumMember, name: string, source: Source): Promise<{ agent: schema.ForumAgent; created: boolean }> {
  const key = forumNameKey(name);
  const had = await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.nameKey, key)) });
  if (had) return { agent: had, created: false };
  const taken = (await db.query.forumAgents.findMany({ where: mineAgents(m), columns: { plotId: true } })).map((a) => a.plotId);
  await db
    .insert(schema.forumAgents)
    .values({ id: newId(), ...m, name, nameKey: key, plotId: plotFor(taken), createdBy: source === "member" ? "member" : source, confirmed: source === "member" })
    .onConflictDoNothing();
  return { agent: (await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.nameKey, key)) }))!, created: true };
}

export type ReportOutcome = { ok: true; agentId: string; agent: string; created: boolean; removed: number; text: string } | { ok: false; status: number; text: string };

/**
 * One report, from any path. The rate limit is per member across every path (60 a minute). What lands: the agent's status and
 * lines, a flow (which clears on its next report), a "needs you" item, cleared items, its road, the headline, and one event
 * per part. A dropped secret is one "removed" event, never the value.
 */
export async function reportToForum(member: ForumMember, raw: unknown, source: Source, via: string | null = null): Promise<ReportOutcome> {
  // Only the owner's two keys go on: a caller's object may carry more (the webhook's settings row id), and every row below spreads it.
  const m: ForumMember = { workspaceId: member.workspaceId, userId: member.userId };
  if (!(await allow(`forum:report:${m.workspaceId}:${m.userId}`, FORUM_REPORTS_PER_MINUTE, 60_000))) return { ok: false, status: 429, text: `At most ${FORUM_REPORTS_PER_MINUTE} reports a minute reach a Forum. Wait a minute and send again.` };
  const parsed = parseForumReport(raw);
  if (!parsed.ok) return { ok: false, status: 400, text: parsed.error };
  const r = parsed.report;
  const { agent, created } = await agentByName(m, r.agent, source);
  const at = r.at ?? nowIso();
  await applyReport(m, agent, r, source, at, via);
  if (parsed.removed.length) await db.insert(schema.forumEvents).values({ id: newId(), ...m, agentId: agent.id, kind: "removed", source, payload: { count: parsed.removed.length }, at, via });
  await pruneForum(m);
  const bits = [r.status ? `status ${r.status}` : null, r.needsYou ? "an item for What needs you" : null, r.flow ? `a message to ${r.flow.to}` : null].filter(Boolean);
  return {
    ok: true,
    agentId: agent.id,
    agent: agent.name,
    created,
    removed: parsed.removed.length,
    text: `Saved to ${agent.name}${created ? " (a new agent: the member confirms it on their Forum)" : ""}${bits.length ? `: ${bits.join(", ")}` : ""}.${parsed.removed.length ? ` ${parsed.removed.length === 1 ? "A value was" : `${parsed.removed.length} values were`} removed because it looked like a key; never send keys.` : ""}`,
  };
}

async function applyReport(m: ForumMember, agent: schema.ForumAgent, r: ForumReport, source: Source, at: string, via: string | null = null): Promise<void> {
  const set: Partial<typeof schema.forumAgents.$inferInsert> = { reportedAt: at, updatedAt: nowIso(), flowTo: null, flowLabel: null, flowAt: null, lastCallAt: at };
  // A status the agent reports itself is the truth: it ends any automatic light (H-19).
  if (r.status) Object.assign(set, { status: r.status, restStatus: null });
  if (r.has.now) set.now = r.now;
  if (r.has.last) set.last = r.last;
  if (r.has.next) set.next = r.next;
  if (r.flow) Object.assign(set, { flowTo: r.flow.to, flowLabel: r.flow.label, flowAt: at });
  if (r.queue) set.queue = r.queue;
  await db.update(schema.forumAgents).set(set).where(eq(schema.forumAgents.id, agent.id));
  // A report is a sign of life: a stall the watch flagged ends here (H-495).
  if (agent.stalledAt) await heardFrom(m, agent);
  const events: (typeof schema.forumEvents.$inferInsert)[] = [];
  const ev = (kind: schema.ForumEvent["kind"], payload: Record<string, unknown>) => events.push({ id: newId(), ...m, agentId: agent.id, kind, source, payload, at, via });
  if (r.status || r.has.now || r.has.last || r.has.next) ev("status", { status: r.status, now: r.now, last: r.last, next: r.next });
  if (r.flow) ev("flow", { to: r.flow.to, label: r.flow.label });
  if (r.queue) ev("queue", { count: r.queue.length });
  if (r.needsYou) {
    await db.insert(schema.forumNeeds).values({ id: newId(), ...m, agentId: agent.id, what: r.needsYou.what, detail: r.needsYou.detail, when: r.needsYou.when });
    ev("needs_you", { what: r.needsYou.what });
  }
  if (r.needsCleared) {
    const open = and(eq(schema.forumNeeds.workspaceId, m.workspaceId), eq(schema.forumNeeds.userId, m.userId), eq(schema.forumNeeds.agentId, agent.id), isNull(schema.forumNeeds.doneAt));
    const which = r.needsCleared === true ? open : and(open, inArray(schema.forumNeeds.what, r.needsCleared));
    await db.update(schema.forumNeeds).set({ doneAt: nowIso(), doneBy: "agent" }).where(which);
  }
  if (r.headline) {
    await forumSettingsFor(m);
    await db.update(schema.forumSettings).set({ headline: r.headline, headlineAt: at }).where(mineSettings(m));
    ev("headline", { headline: r.headline });
  }
  if (events.length) await db.insert(schema.forumEvents).values(events);
}

/** The log keeps 90 days (rev 765 §3); done "needs you" items go with it. */
export async function pruneForum(m: ForumMember): Promise<void> {
  const cutoff = new Date(Date.now() - FORUM_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.delete(schema.forumEvents).where(and(eq(schema.forumEvents.workspaceId, m.workspaceId), eq(schema.forumEvents.userId, m.userId), lt(schema.forumEvents.at, cutoff)));
  await db.delete(schema.forumNeeds).where(and(eq(schema.forumNeeds.workspaceId, m.workspaceId), eq(schema.forumNeeds.userId, m.userId), isNotNull(schema.forumNeeds.doneAt), lt(schema.forumNeeds.doneAt, cutoff)));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Built-in agents: what HelixOS already records, read back (no new tracking).

const DAYS = 14;
const quote = (s: string, n = 60) => `"${s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s}"`;

export async function builtInEvents(m: ForumMember): Promise<Partial<Record<BuiltInKey, BuiltInEvent[]>>> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sinceDb = since.replace("T", " ").slice(0, 19);
  const out: Partial<Record<BuiltInKey, BuiltInEvent[]>> = {};

  // The booking bot: a conversation its chatbot started (a lead with a subscriber id), a call booked.
  const leads = await db.query.contacts.findMany({
    where: and(eq(schema.contacts.workspaceId, m.workspaceId), eq(schema.contacts.userId, m.userId), or(and(isNotNull(schema.contacts.userNs), gte(schema.contacts.createdAt, sinceDb)), gte(schema.contacts.callBookedAt, since))),
    columns: { userNs: true, createdAt: true, callBookedAt: true },
    orderBy: desc(schema.contacts.createdAt),
    limit: 40,
  });
  const booking: BuiltInEvent[] = [];
  for (const l of leads) {
    if (l.userNs && l.createdAt >= sinceDb) booking.push({ at: isoStamp(l.createdAt), text: "A new conversation started" });
    if (l.callBookedAt && l.callBookedAt >= since) booking.push({ at: isoStamp(l.callBookedAt), text: "A call was booked" });
  }
  if (booking.length) out.booking = booking;

  // Ship: a post went out, a ladder shipped, a comment went up under it.
  const ship: BuiltInEvent[] = [];
  const posts = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, m.workspaceId), eq(schema.contentItems.userId, m.userId), gte(schema.contentItems.postedAt, since.slice(0, 10))), columns: { title: true, postedAt: true }, orderBy: desc(schema.contentItems.postedAt), limit: 20 });
  for (const p of posts) if (p.postedAt) ship.push({ at: isoStamp(p.postedAt), text: `Posted ${quote(p.title)}` });
  const ladders = await db.query.ladders.findMany({ where: and(eq(schema.ladders.workspaceId, m.workspaceId), eq(schema.ladders.userId, m.userId), gte(schema.ladders.shippedAt, since)), columns: { postName: true, topic: true, shippedAt: true, rungs: true }, limit: 20 });
  for (const l of ladders) {
    const name = l.postName || l.topic;
    if (l.shippedAt) ship.push({ at: isoStamp(l.shippedAt), text: `Shipped ${quote(name)}` });
    for (const rung of l.rungs ?? []) if (rung.postedAt && rung.postedAt >= since) ship.push({ at: isoStamp(rung.postedAt), text: `Comment ${rung.n} went up under ${quote(name, 40)}` });
  }
  if (ship.length) out.ship = ship;

  // Recordings: a call that turned into action steps for this member.
  const steps = await db
    .select({ recordingId: schema.recordingSteps.recordingId, createdAt: schema.recordingSteps.createdAt, title: schema.recordings.title, clearTitle: schema.recordings.clearTitle })
    .from(schema.recordingSteps)
    .innerJoin(schema.recordings, eq(schema.recordings.id, schema.recordingSteps.recordingId))
    .where(and(eq(schema.recordingSteps.workspaceId, m.workspaceId), eq(schema.recordingSteps.userId, m.userId), gte(schema.recordingSteps.createdAt, sinceDb)))
    .orderBy(asc(schema.recordingSteps.createdAt))
    .limit(200);
  const byRec = new Map<string, { at: string; n: number; title: string }>();
  for (const s of steps) {
    const had = byRec.get(s.recordingId);
    byRec.set(s.recordingId, { at: s.createdAt > (had?.at ?? "") ? s.createdAt : had!.at, n: (had?.n ?? 0) + 1, title: s.clearTitle || s.title });
  }
  if (byRec.size) out.recordings = [...byRec.values()].map((r) => ({ at: isoStamp(r.at), text: `${r.n} action ${r.n === 1 ? "step" : "steps"} from ${quote(r.title, 50)}` }));

  // My Board: a decision made, and the steps it set up. An example (H-257) never counts.
  const decisions = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId), eq(schema.boardDecisions.example, false), gte(schema.boardDecisions.updatedAt, sinceDb)), columns: { question: true, createdAt: true, updatedAt: true, stepTasks: true }, orderBy: desc(schema.boardDecisions.updatedAt), limit: 20 });
  const board: BuiltInEvent[] = [];
  for (const d of decisions) {
    if (d.createdAt >= sinceDb) board.push({ at: isoStamp(d.createdAt), text: `Decided on ${quote(d.question, 50)}` });
    const set = (d.stepTasks ?? []).filter(Boolean).length;
    if (set && d.updatedAt > d.createdAt) board.push({ at: isoStamp(d.updatedAt), text: `${set} ${set === 1 ? "step" : "steps"} added to your tasks` });
  }
  if (board.length) out.board = board;
  return out;
}

/** A stored stamp as an ISO instant: SQLite's "2026-10-12 05:35:00" is UTC; a bare date is its midnight UTC. */
function isoStamp(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return `${s.replace(" ", "T")}Z`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
}

/** The whole Forum for one member, in the mockup's shape. */
export async function forumStateFor(m: ForumMember): Promise<ForumState> {
  const since = new Date(Date.now() - FORUM_FLOW_MS).toISOString();
  const [agents, needs, events, flows, settings, builtIns] = await Promise.all([
    db.query.forumAgents.findMany({ where: mineAgents(m) }),
    db.query.forumNeeds.findMany({ where: and(eq(schema.forumNeeds.workspaceId, m.workspaceId), eq(schema.forumNeeds.userId, m.userId), isNull(schema.forumNeeds.doneAt)) }),
    db.query.forumEvents.findMany({ where: and(eq(schema.forumEvents.workspaceId, m.workspaceId), eq(schema.forumEvents.userId, m.userId)), orderBy: desc(schema.forumEvents.at), limit: 40 }),
    // Every conversation of the last 30 minutes (H-52), newest first; stamps are ISO, so the text compare holds.
    db.query.forumEvents.findMany({ where: and(eq(schema.forumEvents.workspaceId, m.workspaceId), eq(schema.forumEvents.userId, m.userId), eq(schema.forumEvents.kind, "flow"), gte(schema.forumEvents.at, since)), orderBy: desc(schema.forumEvents.at), limit: FORUM_FLOWS_SHOWN, columns: { id: true, agentId: true, payload: true, at: true } }),
    forumSettingsFor(m),
    builtInEvents(m),
  ]);
  return composeForum({ agents, needs, events, flows, builtIns, headline: settings.headline, headlineAt: settings.headlineAt });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Who may look, and the member's own changes.

/** Own Forum always; the coach (not switched into anyone) only while the member's "Share with my coach" is on. */
export async function canReadForum(viewer: { workspace: { id: string }; user: { id: string }; role: string }, ownerId: string): Promise<boolean> {
  if (viewer.user.id === ownerId) return true;
  if (viewer.role !== "coach") return false;
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, viewer.workspace.id), eq(schema.memberships.userId, ownerId)), columns: { removedAt: true } });
  if (!membership || membership.removedAt) return false;
  const s = await db.query.forumSettings.findFirst({ where: mineSettings({ workspaceId: viewer.workspace.id, userId: ownerId }), columns: { shareWithCoach: true } });
  return !!s?.shareWithCoach;
}

/**
 * Move an agent onto a plot (tap two to swap, or drag): whoever is there takes the mover's old plot, which may be the
 * Outer districts. A built-in agent gets its row here, the first time it's moved.
 */
export async function moveForumAgent(m: ForumMember, agentRef: string, plot: string | null): Promise<boolean> {
  if (plot !== null && !isForumPlot(plot)) return false;
  let agent = agentRef.startsWith("builtin:") ? null : await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.id, agentRef)) });
  if (!agent && agentRef.startsWith("builtin:")) agent = await builtInRow(m, agentRef.slice(8));
  if (!agent) return false;
  const state = await forumStateFor(m);
  const from = state.agents.find((a) => a.id === agent!.id || a.id === agentRef)?.plot ?? agent.plotId;
  if (from === plot) return true;
  const occupant = plot ? state.agents.find((a) => a.plot === plot && a.id !== agent!.id) : null;
  await db.update(schema.forumAgents).set({ plotId: null }).where(eq(schema.forumAgents.id, agent.id));
  if (occupant) {
    const row = occupant.id.startsWith("builtin:") ? await builtInRow(m, occupant.id.slice(8)) : await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.id, occupant.id)) });
    if (row) await db.update(schema.forumAgents).set({ plotId: (from as ForumPlot | null) ?? null, updatedAt: nowIso() }).where(eq(schema.forumAgents.id, row.id));
  }
  await db.update(schema.forumAgents).set({ plotId: plot as ForumPlot | null, updatedAt: nowIso() }).where(eq(schema.forumAgents.id, agent.id));
  return true;
}

/** A built-in's row, made at its current spot on the map so moving it doesn't shuffle anyone else. */
async function builtInRow(m: ForumMember, key: string): Promise<schema.ForumAgent | null> {
  if (!isBuiltIn(key)) return null;
  const had = await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.builtIn, key)) });
  if (had) return had;
  const state = await forumStateFor(m);
  const plotId = state.agents.find((a) => a.id === `builtin:${key}`)?.plot ?? null;
  const name = BUILT_INS[key].name;
  const nameKey = forumNameKey(name);
  const clash = await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.nameKey, nameKey)) });
  await db.insert(schema.forumAgents).values({ id: newId(), ...m, name: clash ? `${name} (HelixOS)` : name, nameKey: clash ? `${nameKey} (helixos)` : nameKey, platform: "HelixOS", role: BUILT_INS[key].role, plotId, builtIn: key, createdBy: "builtin", confirmed: true }).onConflictDoNothing();
  return (await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.builtIn, key)) })) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The webhook (rev 765 §2): the secret travels in a header, is stored as a hash, compared in constant time, shown once.

const WEBHOOK_PREFIX = "hxf_";
const hashWebhook = (secret: string) => createHash("sha256").update(secret, "utf8").digest("hex");

export async function makeForumWebhook(m: ForumMember): Promise<string> {
  await forumSettingsFor(m);
  const secret = `${WEBHOOK_PREFIX}${randomBytes(24).toString("base64url")}`;
  await db.update(schema.forumSettings).set({ webhookHash: hashWebhook(secret), webhookCreatedAt: nowIso(), webhookUsedAt: null }).where(mineSettings(m));
  return secret;
}

export async function revokeForumWebhook(m: ForumMember): Promise<void> {
  await db.update(schema.forumSettings).set({ webhookHash: null, webhookCreatedAt: null, webhookUsedAt: null }).where(mineSettings(m));
}

/** The member a webhook secret belongs to, or null. Only a secret of the right shape is looked up; the match is constant-time. */
export async function memberForWebhook(secret: string): Promise<ForumMember | null> {
  if (!secret.startsWith(WEBHOOK_PREFIX) || secret.length < 20 || secret.length > 100) return null;
  const hash = hashWebhook(secret);
  const row = await db.query.forumSettings.findFirst({ where: eq(schema.forumSettings.webhookHash, hash), columns: { id: true, workspaceId: true, userId: true, webhookHash: true } });
  if (!row?.webhookHash || !safeEqual(row.webhookHash, hash)) return null;
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, row.workspaceId), eq(schema.memberships.userId, row.userId)), columns: { id: true, removedAt: true } });
  if (!membership || membership.removedAt) return null;
  await db.update(schema.forumSettings).set({ webhookUsedAt: nowIso() }).where(eq(schema.forumSettings.id, row.id));
  return { workspaceId: row.workspaceId, userId: row.userId };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Automatic lights (H-19, H-26 B): any call through an agent's own connection lights its building; a post lights the road.

/** A call just came through this agent's connection: working now, and the status it reported itself kept to go back to. */
export async function agentCalled(m: ForumMember, agentId: string): Promise<void> {
  const a = await db.query.forumAgents.findFirst({ where: and(mineAgents(m), eq(schema.forumAgents.id, agentId)), columns: { id: true, status: true, restStatus: true, stalledAt: true, stallNeedId: true } });
  if (!a) return;
  const now = nowIso();
  await db.update(schema.forumAgents).set(a.status === "working" ? { lastCallAt: now } : { lastCallAt: now, restStatus: a.restStatus ?? a.status, status: "working", updatedAt: now }).where(eq(schema.forumAgents.id, a.id));
  if (a.stalledAt) await heardFrom(m, a);
}

/**
 * A message from one agent to others, or to the member, draws its flows on the map without a separate report: one event per
 * recipient (the title as the label, a reply marked so it can walk back), and the sender's own flow pointing at the first.
 */
export async function drawFlows(m: ForumMember, from: { id: string }, toNames: string[], label: string, reply: boolean, ref: string | null): Promise<void> {
  if (!toNames.length) return;
  const at = nowIso();
  const clean = cleanLine(label, FORUM_MAX.flowLabel) ?? "";
  await db.insert(schema.forumEvents).values(toNames.map((to) => ({ id: newId(), ...m, agentId: from.id, kind: "flow" as const, source: "agent" as const, payload: { to, label: clean, reply, ref }, at })));
  await db.update(schema.forumAgents).set({ flowTo: toNames[0], flowLabel: clean, flowAt: at, lastCallAt: at }).where(eq(schema.forumAgents.id, from.id));
}
