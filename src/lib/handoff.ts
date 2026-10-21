/**
 * The Handoff inbox (rev 769), the database side. Every inbox is one member's own (H-727): the coach's (Danno's) on Coach →
 * Inbox, a member's on the Agent inbox beside The Forum, every row keyed by the owner. An agent is one of the owner's Forum
 * agents, and its identity is its token or its tied connection, never a name typed in a message. Agents post, read, ack and
 * move files; only the owner decides, by hand, signed in (`decideHandoff` is called from the owner's own actions and nowhere
 * else). A decision is one answer from the owner (the "danno" recipient, whoever owns the inbox), delivered once in the
 * sender's next handoff_inbox. The owner is shown by first name. Every post, file, ack, decision and token change is in the audit.
 */
import { cutText } from "@/lib/engine/cut";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl } from "@/lib/branded-email";
import { hashSecret, safeEqual } from "@/lib/crypto";
import { nowIso, todayInTz } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { canEmail } from "@/lib/email-gate";
import { newId } from "@/lib/ids";
import { allow } from "@/lib/rate-limit";
import { headProofObject, deleteProofObject, presignHandoffUpload, putHandoffObject, readProofObject } from "@/lib/proof-storage";
import { drawFlows, reportToForum } from "@/lib/forum";
import { heardFrom } from "@/lib/forum-watch";
import { forumNameKey, looksLikeSecret } from "@/lib/engine/forum";
import { minuteOf, PING_TITLE } from "@/lib/engine/agent-connection";
import {
  DANNO,
  HANDOFF_FILE_MAX_BYTES,
  HANDOFF_LINK_MINUTES,
  HANDOFF_MAX,
  HANDOFF_POSTS_PER_MINUTE,
  HANDOFF_TOTAL_BYTES,
  CHECKINS_PER_DAY,
  approvalNeeds,
  claimsApproval,
  decideCheckin,
  inActiveHours,
  fileNameRefusal,
  fileTypeFor,
  hId,
  parseHId,
  parseHandoffPost,
  safeFileName,
  scrubText,
  zipCentral,
  type CheckinAct,
  type HandoffKind,
  decidable,
  holdReason,
  inboxHref,
  ownerFirst,
} from "@/lib/engine/handoff";

export type Owner = { workspaceId: string; userId: string };
const mine = (o: Owner) => and(eq(schema.handoffMessages.workspaceId, o.workspaceId), eq(schema.handoffMessages.userId, o.userId));
const agentsOf = (o: Owner) => db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)) });

/** The owner as the inbox names them: first name, and whether it is the coach's inbox (Coach → Inbox) or a member's. */
export async function ownerOf(o: Owner): Promise<{ first: string; coach: boolean }> {
  const [u, m] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, o.userId), columns: { name: true } }),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)), columns: { role: true } }),
  ]);
  return { first: ownerFirst(u?.name), coach: m?.role === "coach" };
}

/** Whether a member has the Agent inbox in their menu (H-727): an agent of their own on the Forum, or anything in the inbox. */
export async function agentsOnFor(o: Owner): Promise<boolean> {
  const [agent, message] = await Promise.all([
    db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), isNull(schema.forumAgents.builtIn)), columns: { id: true } }),
    db.query.handoffMessages.findFirst({ where: mine(o), columns: { id: true } }),
  ]);
  return Boolean(agent || message);
}

export async function audit(o: Owner, agentId: string | null, action: string, ref: string | null = null, note: string | null = null): Promise<void> {
  await db.insert(schema.handoffAudit).values({ id: newId(), ...o, agentId, action, ref, note: note ? cutText(note, 300) : null, at: nowIso() });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Agent tokens (rev 769 §1): one per agent, shown once, stored as a hash, revocable; each acts through its own connection row.

const TOKEN_PREFIX = "hxa_";
export const AGENT_TOKEN_CLIENT = "helixos-agent-token";

export async function makeAgentToken(o: Owner & { membershipId: string }, agentId: string): Promise<string | null> {
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!agent || agent.builtIn) return null;
  await revokeAgentTokens(o, agentId, "rotated");
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const appId = newId();
  await db.insert(schema.connectedApps).values({ id: appId, workspaceId: o.workspaceId, userId: o.userId, membershipId: o.membershipId, clientId: AGENT_TOKEN_CLIENT, name: `Agent token: ${agent.name}`, scopes: ["forum", "inbox"], agentId });
  await db.insert(schema.agentTokens).values({ id: newId(), workspaceId: o.workspaceId, userId: o.userId, agentId, appId, tokenHash: hashSecret(token), last4: token.slice(-4) });
  await audit(o, agentId, "token made", agent.name);
  return token;
}

export async function revokeAgentTokens(o: Owner, agentId: string, why = "revoked"): Promise<void> {
  const live = await db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, o.workspaceId), eq(schema.agentTokens.userId, o.userId), eq(schema.agentTokens.agentId, agentId), isNull(schema.agentTokens.revokedAt)) });
  const now = nowIso();
  for (const t of live) {
    await db.update(schema.agentTokens).set({ revokedAt: now }).where(eq(schema.agentTokens.id, t.id));
    await db.update(schema.connectedApps).set({ revokedAt: now }).where(eq(schema.connectedApps.id, t.appId));
  }
  if (live.length && why === "revoked") await audit(o, agentId, "token revoked");
}

/**
 * The Partner Program on an agent's token (H-1361): the coach ticks it per agent on Coach → Agents, and the live token's
 * connection gains or loses the `partner` scope. A token made later starts without it. Nothing else on the token changes.
 */
export async function setAgentPartnerScope(o: Owner, agentId: string, on: boolean): Promise<boolean> {
  const live = await db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, o.workspaceId), eq(schema.agentTokens.userId, o.userId), eq(schema.agentTokens.agentId, agentId), isNull(schema.agentTokens.revokedAt)) });
  if (!live.length) return false;
  for (const t of live) {
    const app = await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, t.appId) });
    if (!app) continue;
    const scopes = app.scopes.filter((x) => x !== "partner");
    if (on) scopes.push("partner");
    await db.update(schema.connectedApps).set({ scopes }).where(eq(schema.connectedApps.id, app.id));
  }
  await audit(o, agentId, on ? "partner tools on" : "partner tools off");
  return true;
}

/** Whether an agent's live token carries the Partner Program. */
export async function agentPartnerScopes(o: Owner, agentIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!agentIds.length) return out;
  const live = await db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, o.workspaceId), eq(schema.agentTokens.userId, o.userId), inArray(schema.agentTokens.agentId, agentIds), isNull(schema.agentTokens.revokedAt)) });
  for (const t of live) {
    const app = await db.query.connectedApps.findFirst({ where: eq(schema.connectedApps.id, t.appId), columns: { scopes: true } });
    if (app?.scopes.includes("partner")) out.set(t.agentId, true);
  }
  return out;
}

/** A bearer agent token to its live token row and connection, or null. Only a token of the right shape is looked up. */
export async function agentTokenRow(token: string): Promise<{ tokenId: string; appId: string } | null> {
  if (!/^hxa_[A-Za-z0-9_-]{40,50}$/.test(token)) {
    await countAuthFailure(null).catch(() => undefined);
    return null;
  }
  const hash = hashSecret(token);
  const row = await db.query.agentTokens.findFirst({ where: eq(schema.agentTokens.tokenHash, hash) });
  if (!row || row.revokedAt || !safeEqual(row.tokenHash, hash)) {
    await countAuthFailure(row && row.revokedAt ? row : null).catch(() => undefined);
    return null;
  }
  await db.update(schema.agentTokens).set({ lastUsedAt: nowIso() }).where(eq(schema.agentTokens.id, row.id));
  return { tokenId: row.id, appId: row.appId };
}

/**
 * Check connection (H-559): one more refused call this minute, against the agent whose revoked token it was, or on the global
 * count. Only the agent, the owner and the minute are kept; never the token or anything that could find it.
 */
async function countAuthFailure(revoked: { workspaceId: string; userId: string; agentId: string } | null, now: Date = new Date()): Promise<void> {
  const minute = minuteOf(now);
  const values = revoked
    ? { id: newId(), scope: `agent:${revoked.agentId}`, workspaceId: revoked.workspaceId, userId: revoked.userId, agentId: revoked.agentId, minute, count: 1 }
    : { id: newId(), scope: "global", workspaceId: null, userId: null, agentId: null, minute, count: 1 };
  await db
    .insert(schema.agentAuthFailures)
    .values(values)
    .onConflictDoUpdate({ target: [schema.agentAuthFailures.scope, schema.agentAuthFailures.minute], set: { count: sql`${schema.agentAuthFailures.count} + 1` } });
}

export type AgentConnection = {
  token: { createdAt: string; lastUsedAt: string | null; last4: string } | null;
  lastTool: string | null;
  failures: { minute: string; count: number }[];
  ping: { sentAt: string; ackedAt: string | null } | null;
};

/** Check connection (H-559): what HelixOS recorded for each agent: its live token, its last tool, recent refusals, its last ping. */
export async function agentConnections(o: Owner, agentIds: string[], now: Date = new Date()): Promise<Map<string, AgentConnection>> {
  const out = new Map<string, AgentConnection>();
  if (!agentIds.length) return out;
  const weekAgo = minuteOf(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const [tokens, fails, pings] = await Promise.all([
    db.query.agentTokens.findMany({ where: and(eq(schema.agentTokens.workspaceId, o.workspaceId), eq(schema.agentTokens.userId, o.userId), inArray(schema.agentTokens.agentId, agentIds), isNull(schema.agentTokens.revokedAt)), orderBy: desc(schema.agentTokens.createdAt) }),
    db.query.agentAuthFailures.findMany({ where: and(eq(schema.agentAuthFailures.workspaceId, o.workspaceId), eq(schema.agentAuthFailures.userId, o.userId), inArray(schema.agentAuthFailures.agentId, agentIds), sql`${schema.agentAuthFailures.minute} >= ${weekAgo}`) }),
    db
      .select({ createdAt: schema.handoffMessages.createdAt, recipient: schema.handoffDeliveries.recipient, ackedAt: schema.handoffDeliveries.ackedAt })
      .from(schema.handoffMessages)
      .innerJoin(schema.handoffDeliveries, eq(schema.handoffDeliveries.messageId, schema.handoffMessages.id))
      .where(and(mine(o), isNull(schema.handoffMessages.fromAgentId), eq(schema.handoffMessages.title, PING_TITLE), inArray(schema.handoffDeliveries.recipient, agentIds)))
      .orderBy(desc(schema.handoffMessages.seq)),
  ]);
  const appIds = tokens.map((t) => t.appId);
  const apps = appIds.length ? await db.query.connectedApps.findMany({ where: inArray(schema.connectedApps.id, appIds), columns: { id: true, lastTool: true } }) : [];
  for (const id of agentIds) {
    const t = tokens.find((x) => x.agentId === id) ?? null;
    const p = pings.find((x) => x.recipient === id) ?? null;
    out.set(id, {
      token: t ? { createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, last4: t.last4 } : null,
      lastTool: t ? (apps.find((a) => a.id === t.appId)?.lastTool ?? null) : null,
      failures: fails.filter((f) => f.agentId === id).map((f) => ({ minute: f.minute, count: f.count })),
      ping: p ? { sentAt: p.createdAt, ackedAt: p.ackedAt } : null,
    });
  }
  return out;
}

/** Tie one of the owner's own connections (Cowork's claude.ai connector) to an agent, or untie it. Only the owner, by hand. */
export async function tieConnection(o: Owner, appId: string, agentId: string | null): Promise<boolean> {
  const app = await db.query.connectedApps.findFirst({ where: and(eq(schema.connectedApps.workspaceId, o.workspaceId), eq(schema.connectedApps.userId, o.userId), eq(schema.connectedApps.id, appId), isNull(schema.connectedApps.revokedAt)) });
  if (!app || app.clientId === AGENT_TOKEN_CLIENT) return false;
  if (agentId) {
    const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
    if (!agent || agent.builtIn) return false;
  }
  await db.update(schema.connectedApps).set({ agentId }).where(eq(schema.connectedApps.id, app.id));
  await audit(o, agentId, agentId ? "connection tied" : "connection untied", app.name);
  return true;
}

/** The agent a call speaks as: the connection's tied agent, still on the owner's Forum. */
export async function callingAgent(o: Owner, agentId: string | null | undefined): Promise<schema.ForumAgent> {
  // Only the coach ties connections today (Coach → Agents); a member's agent connections come later (H-727 PR 2).
  if (!agentId) {
    const who = await ownerOf(o);
    throw new Error(who.coach ? `This connection isn't tied to an agent, so it can't use the inbox. ${who.first} ties it on Coach → Agents.` : "This connection isn't tied to an agent yet, so it can't use the inbox.");
  }
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!agent) {
    const who = await ownerOf(o);
    throw new Error(`This connection's agent is no longer on the Forum.${who.coach ? ` ${who.first} can tie it to another on Coach → Agents.` : ""}`);
  }
  return agent;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Messages.

async function nextSeq(o: Owner): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${schema.handoffMessages.seq}), 0)` }).from(schema.handoffMessages).where(mine(o));
  return Number(row?.max ?? 0) + 1;
}

async function insertMessage(o: Owner, values: Omit<typeof schema.handoffMessages.$inferInsert, "id" | "workspaceId" | "userId" | "seq">, recipients: string[]): Promise<schema.HandoffMessage> {
  for (let tries = 0; ; tries++) {
    const id = newId();
    const seq = await nextSeq(o);
    try {
      await db.insert(schema.handoffMessages).values({ id, ...o, seq, ...values, threadId: values.threadId ?? id });
      for (const r of recipients) await db.insert(schema.handoffDeliveries).values({ id: newId(), messageId: id, recipient: r }).onConflictDoNothing();
      return (await db.query.handoffMessages.findFirst({ where: eq(schema.handoffMessages.id, id) }))!;
    } catch (e) {
      if (tries >= 4) throw e;
    }
  }
}

export type PostOutcome = { id: string; seq: number; needsApproval: boolean; reasons: string[]; removed: number };

/** handoff_post: from the calling agent, never anyone else. */
export async function postHandoff(o: Owner, from: schema.ForumAgent, raw: Record<string, unknown>): Promise<PostOutcome> {
  if (!(await allow(`handoff:post:${from.id}`, HANDOFF_POSTS_PER_MINUTE, 60_000))) throw new Error(`At most ${HANDOFF_POSTS_PER_MINUTE} posts a minute per agent. Wait a minute and post again.`);
  const parsed = parseHandoffPost(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  const p = parsed.post;
  const agents = await agentsOf(o);
  const byName = new Map(agents.map((a) => [a.nameKey, a]));
  const to: string[] = [];
  for (const name of p.to) {
    const key = forumNameKey(name);
    if (key === DANNO || key === "you" || key === "owner") to.push(DANNO);
    else if (byName.get(key)) to.push(byName.get(key)!.id);
    else throw new Error(`There's no agent called "${name}" on the Forum. Send to one of: ${["you", ...agents.filter((a) => !a.builtIn).map((a) => a.name)].join(", ")} ("you" is the inbox's owner; "danno" works too).`);
  }
  let replyToId: string | null = null;
  let threadId: string | null = null;
  if (p.replyTo !== null) {
    const parent = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.seq, p.replyTo)) });
    if (!parent) throw new Error(`There's no ${hId(p.replyTo)} to reply to.`);
    replyToId = parent.id;
    threadId = parent.threadId ?? parent.id;
  }
  for (const f of p.files) await readyFile(o, f, from.id);
  const text = `${p.title}\n${p.body}`;
  const reasons = approvalNeeds(p.kind, p.needsApproval, text);
  const who = await ownerOf(o);
  const row = await insertMessage(o, { fromAgentId: from.id, toIds: [...new Set(to)], kind: p.kind, title: p.title, body: p.body, replyToId, threadId, fileIds: p.files, needsApproval: reasons.length > 0, approvalReasons: reasons, claimsApproval: claimsApproval(text, who.first) }, [...new Set(to)]);
  await audit(o, from.id, "post", hId(row.seq), p.title);
  // H-1494: a "Merged PR #N" post settles every open "needs you" item that names that PR.
  const mergedPr = /^Merged PR #(\d+)\b/i.exec(p.title);
  if (mergedPr) await clearNeedsForPr(o, Number(mergedPr[1]));
  // H-351: a replacement marks the post it replaces in the same call (the agent's own post only).
  if (p.supersedes !== null) await supersedeHandoff(o, from.id, hId(p.supersedes), hId(row.seq));
  // A status message updates the sender's Forum building.
  if (p.kind === "status") await reportToForum(o, { agent: from.name, status: "working", now: p.title }, "agent");
  // The road lights on its own (H-19): a flow to each recipient, the title as its label; a reply walks back the same road.
  const names = [...new Set(to)].map((id) => (id === DANNO ? "you" : (agents.find((a) => a.id === id)?.name ?? null))).filter((n): n is string => Boolean(n));
  await drawFlows(o, from, names, p.title, p.replyTo !== null, hId(row.seq));
  if (reasons.length) await alertOwner(o, row, from.name);
  return { id: row.id, seq: row.seq, needsApproval: reasons.length > 0, reasons, removed: p.removed };
}

/**
 * The owner's email when something needs their approval (rev 816: email now, push later), behind their switch and canEmail.
 * The coach's only for now (H-727): a new email to members waits for Danno's own decision, and their inbox shows it either way.
 */
export async function alertOwner(o: Owner, row: schema.HandoffMessage, fromName: string): Promise<void> {
  if (!(await ownerOf(o)).coach) return;
  const settings = await db.query.forumSettings.findFirst({ where: and(eq(schema.forumSettings.workspaceId, o.workspaceId), eq(schema.forumSettings.userId, o.userId)), columns: { approvalEmails: true } });
  if (settings && !settings.approvalEmails) return;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)) });
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, o.userId) });
  if (!m || !u || !(await canEmail(m.id))) return;
  // The title only: an agent's body never goes out by email.
  await sendEmail(u.email, `${hId(row.seq)} needs your approval`, `${fromName} posted ${hId(row.seq)}, "${row.title}", and it needs your approval (${row.approvalReasons.join(", ")}).\n\nOpen your inbox: ${appUrl()}${inboxHref(true)}\n\nTurn these emails off on Coach → Inbox.`);
}

export type InboxItem = { id: string; ref: string; kind: string; from: string; to: string[]; title: string; body: string; replyTo: string | null; files: { id: string; name: string; size: number }[]; needsApproval: boolean; reasons: string[]; claimsApproval: boolean; decision: string | null; decisionFor: string | null; decidedAt: string | null; fromDanno: boolean; at: string; /** H-351 */ hold: { reason: string; at: string } | null; supersededBy: string | null; /** H-356: when the agent's inbox read took Danno's decision on this post; null until then. */ decisionReadAt: string | null; /** H-356: more than three minutes since the decision with no read. */ decisionLate: boolean; /** H-356: the deciding agent's last inbox read and its session link, for "not read yet" and Nudge. */ agentSeenAt: string | null; agentSessionUrl: string | null };

async function describe(o: Owner, rows: schema.HandoffMessage[], owner?: string): Promise<InboxItem[]> {
  if (!rows.length) return [];
  const [agents, who] = await Promise.all([agentsOf(o), owner ? Promise.resolve(owner) : ownerOf(o).then((w) => w.first)]);
  const name = (id: string | null) => (id === null || id === DANNO ? who : (agents.find((a) => a.id === id)?.name ?? "A removed agent"));
  const fileIds = [...new Set(rows.flatMap((r) => r.fileIds))];
  const files = fileIds.length ? await db.query.handoffFiles.findMany({ where: and(eq(schema.handoffFiles.workspaceId, o.workspaceId), eq(schema.handoffFiles.userId, o.userId), inArray(schema.handoffFiles.id, fileIds)) }) : [];
  const parents = new Map<string, number>();
  const parentIds = [...new Set(rows.flatMap((r) => [r.replyToId ?? r.decisionForId, r.supersededById]).filter(Boolean) as string[])];
  if (parentIds.length) for (const p of await db.query.handoffMessages.findMany({ where: inArray(schema.handoffMessages.id, parentIds), columns: { id: true, seq: true } })) parents.set(p.id, p.seq);
  // H-356: for a decided post, the owner's answer row and its delivery to the agent say when the agent read the decision.
  const decidedIds = rows.filter((r) => r.decision && r.fromAgentId).map((r) => r.id);
  const answers = decidedIds.length ? await db.query.handoffMessages.findMany({ where: and(mine(o), inArray(schema.handoffMessages.decisionForId, decidedIds)), columns: { id: true, decisionForId: true } }) : [];
  const answerDeliveries = answers.length ? await db.query.handoffDeliveries.findMany({ where: inArray(schema.handoffDeliveries.messageId, answers.map((a) => a.id)) }) : [];
  const readAt = new Map<string, string>();
  for (const a of answers) {
    const d = answerDeliveries.find((x) => x.messageId === a.id && x.recipient !== DANNO && x.deliveredAt);
    if (d?.deliveredAt && a.decisionForId) readAt.set(a.decisionForId, d.deliveredAt);
  }
  const agentIds = [...new Set(rows.map((r) => r.fromAgentId).filter((x): x is string => Boolean(x)))];
  const settings = agentIds.length ? await db.query.handoffAgents.findMany({ where: and(eq(schema.handoffAgents.workspaceId, o.workspaceId), eq(schema.handoffAgents.userId, o.userId), inArray(schema.handoffAgents.agentId, agentIds)) }) : [];
  const seenAt = new Map<string, string>();
  if (agentIds.length) {
    const lastReads = await db
      .select({ recipient: schema.handoffDeliveries.recipient, at: sql<string>`max(${schema.handoffDeliveries.deliveredAt})` })
      .from(schema.handoffDeliveries)
      .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
      .where(and(mine(o), inArray(schema.handoffDeliveries.recipient, agentIds)))
      .groupBy(schema.handoffDeliveries.recipient);
    for (const l of lastReads) if (l.at) seenAt.set(l.recipient, l.at);
  }
  return rows.map((r) => ({
    id: r.id,
    ref: hId(r.seq),
    kind: r.kind,
    from: name(r.fromAgentId),
    to: r.toIds.map(name),
    title: r.title,
    body: r.body,
    replyTo: r.replyToId && parents.has(r.replyToId) ? hId(parents.get(r.replyToId)!) : null,
    files: r.fileIds.map((id) => files.find((f) => f.id === id)).filter((f): f is schema.HandoffFile => !!f && f.status === "ready").map((f) => ({ id: f.id, name: f.name, size: f.size })),
    needsApproval: r.needsApproval,
    reasons: r.approvalReasons,
    claimsApproval: r.claimsApproval,
    decision: r.decision,
    decisionFor: r.decisionForId && parents.has(r.decisionForId) ? hId(parents.get(r.decisionForId)!) : null,
    decidedAt: r.decidedAt,
    fromDanno: r.fromAgentId === null,
    hold: r.holdReason ? { reason: r.holdReason, at: r.heldAt ?? r.createdAt } : null,
    supersededBy: r.supersededById && parents.has(r.supersededById) ? hId(parents.get(r.supersededById)!) : null,
    decisionReadAt: readAt.get(r.id) ?? null,
    decisionLate: !readAt.has(r.id) && !!r.decidedAt && Date.now() - new Date(r.decidedAt).getTime() > 3 * 60 * 1000,
    agentSeenAt: r.fromAgentId ? (seenAt.get(r.fromAgentId) ?? settings.find((x) => x.agentId === r.fromAgentId)?.lastCheckinAt ?? null) : null,
    agentSessionUrl: r.fromAgentId ? (settings.find((x) => x.agentId === r.fromAgentId)?.sessionUrl ?? null) : null,
    at: r.createdAt,
  }));
}

/**
 * handoff_inbox: what's new for this agent, oldest first, each delivered once. Approvals come as the owner's answers among
 * them, marked with the decision (only the owner's signed-in action makes one).
 */
export async function inboxFor(o: Owner, recipient: string): Promise<InboxItem[]> {
  const rows = await db
    .select({ d: schema.handoffDeliveries, m: schema.handoffMessages })
    .from(schema.handoffDeliveries)
    .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
    .where(and(mine(o), eq(schema.handoffDeliveries.recipient, recipient), isNull(schema.handoffDeliveries.deliveredAt)))
    .orderBy(asc(schema.handoffMessages.seq))
    .limit(50);
  if (!rows.length) return [];
  const now = nowIso();
  for (const r of rows) await db.update(schema.handoffDeliveries).set({ deliveredAt: now }).where(and(eq(schema.handoffDeliveries.id, r.d.id), isNull(schema.handoffDeliveries.deliveredAt)));
  return describe(o, rows.map((r) => r.m));
}

/** A message and its whole thread, for an agent that sent or received something in it. */
export async function readThread(o: Owner, agentId: string | null, ref: unknown): Promise<InboxItem[]> {
  const seq = parseHId(ref);
  const row = seq === null ? null : await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.seq, seq)) });
  if (!row) throw new Error(`There's no ${seq === null ? String(ref) : hId(seq)} in the inbox.`);
  const thread = await db.query.handoffMessages.findMany({ where: and(mine(o), eq(schema.handoffMessages.threadId, row.threadId ?? row.id)), orderBy: asc(schema.handoffMessages.seq) });
  if (agentId && !thread.some((t) => t.fromAgentId === agentId || t.toIds.includes(agentId))) throw new Error(`${hId(row.seq)} isn't in a thread this agent is part of.`);
  return describe(o, thread);
}

/** handoff_ack: seen, with an optional one-line note ("queued after Bot connection"). */
export async function ackHandoff(o: Owner, agentId: string, ref: unknown, note: unknown): Promise<string> {
  const seq = parseHId(ref);
  const row = seq === null ? null : await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.seq, seq)) });
  if (!row) throw new Error(`There's no ${String(ref)} in the inbox.`);
  const line = scrubText(cutText(String(note ?? "").replace(/\s+/g, " ").trim(), HANDOFF_MAX.note)).text || null;
  const done = await db.update(schema.handoffDeliveries).set({ ackedAt: nowIso(), ackNote: line, deliveredAt: sql`coalesce(${schema.handoffDeliveries.deliveredAt}, ${nowIso()})` }).where(and(eq(schema.handoffDeliveries.messageId, row.id), eq(schema.handoffDeliveries.recipient, agentId))).returning({ id: schema.handoffDeliveries.id });
  if (!done.length) throw new Error(`${hId(row.seq)} wasn't sent to this agent, so there's nothing to ack.`);
  await audit(o, agentId, "ack", hId(row.seq), line);
  return `${hId(row.seq)} marked seen${line ? `: ${line}` : ""}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Decisions: only the owner, only by hand. Called from the owner's own signed-in actions; no connector tool reaches this.

export async function decideHandoff(o: Owner, actorUserId: string, messageId: string, decision: "approved" | "changed" | "declined", note: string): Promise<{ ok: boolean; text: string }> {
  const row = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, messageId)) });
  if (!row || !row.needsApproval) return { ok: false, text: "That message isn't waiting for a decision." };
  // H-351: a held or superseded post takes no decision, whatever a button sent.
  const can = decidable(await holdStateOf(o, row));
  if (!can.ok) return can;
  if (decision === "changed" && !note.trim()) return { ok: false, text: "Say what to change." };
  const now = nowIso();
  // One tap per decision: only the first lands.
  const claimed = await db.update(schema.handoffMessages).set({ decision, decisionNote: note || null, decidedAt: now, decidedBy: actorUserId }).where(and(eq(schema.handoffMessages.id, row.id), isNull(schema.handoffMessages.decision))).returning({ id: schema.handoffMessages.id });
  if (!claimed.length) return { ok: false, text: `${hId(row.seq)} was already decided.` };
  const word = decision === "approved" ? "Approved" : decision === "changed" ? "Change" : "Declined";
  const to = row.fromAgentId ? [row.fromAgentId] : [];
  await insertMessage(o, { fromAgentId: null, toIds: to, kind: "answer", title: cutText(`${word}: ${hId(row.seq)} ${row.title}`, HANDOFF_MAX.title), body: scrubText(cutText(note, HANDOFF_MAX.change)).text, replyToId: row.id, threadId: row.threadId ?? row.id, decision, decidedAt: now, decidedBy: actorUserId, decisionForId: row.id }, to);
  await audit(o, null, decision === "approved" ? "approve" : decision === "changed" ? "change" : "decline", hId(row.seq), note || null);
  // H-1494: the decision settles every open "needs you" item that names this H-number.
  await clearNeedsForRef(o, hId(row.seq));
  return { ok: true, text: `${word}: ${hId(row.seq)}. ${row.fromAgentId ? "The agent reads its inbox every few minutes; this post says when it has." : ""}` };
}

/** The owner's own answer to a message, without a decision. */
export async function answerHandoff(o: Owner, messageId: string, body: string): Promise<boolean> {
  const row = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, messageId)) });
  const text = scrubText(cutText(body.trim(), HANDOFF_MAX.body)).text;
  if (!row || !text || !row.fromAgentId) return false;
  const answer = await insertMessage(o, { fromAgentId: null, toIds: [row.fromAgentId], kind: "answer", title: cutText(`Re: ${row.title}`, HANDOFF_MAX.title), body: text, replyToId: row.id, threadId: row.threadId ?? row.id }, [row.fromAgentId]);
  await audit(o, null, "answer", hId(answer.seq));
  return true;
}

/**
 * A note after a decision (H-47): an answer from the owner to the sender, tied to the decided message, shown under it. The decision
 * itself never changes; only a decided message takes a note.
 */
export async function noteDecision(o: Owner, messageId: string, note: string): Promise<{ ok: boolean; text: string }> {
  const row = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, messageId)) });
  const text = scrubText(cutText(note.replace(/\s+/g, " ").trim(), HANDOFF_MAX.change)).text;
  if (!row || !row.decision) return { ok: false, text: "That message hasn't been decided." };
  if (!text) return { ok: false, text: "Write the note first." };
  if (!row.fromAgentId) return { ok: false, text: "That message is your own." };
  const word = row.decision === "approved" ? "Approved" : row.decision === "changed" ? "Change" : "Declined";
  const answer = await insertMessage(o, { fromAgentId: null, toIds: [row.fromAgentId], kind: "answer", title: cutText(`Note on ${hId(row.seq)} (${word}): ${text}`, HANDOFF_MAX.title), body: text, replyToId: row.id, threadId: row.threadId ?? row.id, decisionForId: row.id }, [row.fromAgentId]);
  await audit(o, null, "note", hId(row.seq), cutText(text, HANDOFF_MAX.note));
  return { ok: true, text: `Note sent as ${hId(answer.seq)}.` };
}

/** The owner's view: messages newest first, the waiting decisions, and the menu count (waiting decisions and unread for the owner). */
export async function ownerInbox(o: Owner, limit = 60): Promise<{ items: InboxItem[]; waiting: InboxItem[]; fresh: InboxItem[]; needs: OpenNeed[]; acks: Map<string, { recipient: string; note: string | null; at: string }[]> }> {
  const rows = await db.query.handoffMessages.findMany({ where: mine(o), orderBy: desc(schema.handoffMessages.seq), limit });
  // H-1488: New for you, the messages to the owner the number counted as unread, plus those read in the last few minutes, so the
  // list survives the page's own refresh of the number once it has marked them read.
  const recent = new Date(Date.now() - FRESH_KEEP_MS).toISOString();
  const freshRows = (
    await db
      .select({ m: schema.handoffMessages })
      .from(schema.handoffDeliveries)
      .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
      .where(and(mine(o), eq(schema.handoffDeliveries.recipient, DANNO), eq(schema.handoffMessages.needsApproval, false), or(isNull(schema.handoffDeliveries.deliveredAt), gt(schema.handoffDeliveries.deliveredAt, recent))))
      .orderBy(desc(schema.handoffMessages.seq))
      .limit(limit)
  ).map((r) => r.m);
  const needs = await openNeeds(o);
  const waitingRows = await db.query.handoffMessages.findMany({ where: and(mine(o), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision), isNull(schema.handoffMessages.holdReason), isNull(schema.handoffMessages.supersededById)), orderBy: asc(schema.handoffMessages.seq) });
  const deliveries = rows.length ? await db.query.handoffDeliveries.findMany({ where: inArray(schema.handoffDeliveries.messageId, rows.map((r) => r.id)) }) : [];
  const [agents, { first }] = await Promise.all([agentsOf(o), ownerOf(o)]);
  const acks = new Map<string, { recipient: string; note: string | null; at: string }[]>();
  for (const d of deliveries) if (d.ackedAt) acks.set(d.messageId, [...(acks.get(d.messageId) ?? []), { recipient: d.recipient === DANNO ? first : (agents.find((a) => a.id === d.recipient)?.name ?? "An agent"), note: d.ackNote, at: d.ackedAt }]);
  return { items: await describe(o, rows, first), waiting: await describe(o, waitingRows, first), fresh: await describe(o, freshRows, first), needs, acks };
}

// ---------------------------------------------------------------------------------------------------------------------------
// H-1488 and H-1494: one list for the owner. The Inbox number counts exactly what the Inbox shows as waiting on them (the
// undecided approvals and the agents' open "needs you" items) plus the unread messages it lists under New for you.

const H_REF = /\bH-(\d+)\b/;
/** An item older than this gets "still needed?" to its agent at its next check-in (H-1494 §3). */
export const NEED_STALE_MS = 72 * 60 * 60 * 1000;
/** New for you keeps a message this long after the page marked it read. */
const FRESH_KEEP_MS = 15 * 60 * 1000;

export type OpenNeed = { id: string; agentId: string | null; agent: string | null; what: string; detail: string | null; when: string | null; at: string; ref: string | null; stale: boolean };

/** The H-number an item names, if any: the thread the Inbox links it to, and the approval whose decision settles it. */
export const needRef = (what: string, detail: string | null): string | null => {
  const m = H_REF.exec(`${what} ${detail ?? ""}`);
  return m ? `H-${m[1]}` : null;
};
/** The pull requests an item names (#99), settled by a "Merged PR #99" post. */
export const needPrs = (what: string, detail: string | null): number[] => [...`${what} ${detail ?? ""}`.matchAll(/(?:^|[^\w])#(\d+)\b/g)].map((m) => Number(m[1]));

/** SQLite's datetime('now') ("2026-10-21 05:00:00") is UTC without a zone; an ISO stamp passes through. */
const sqlTime = (t: string): number => new Date(/[TZ]/.test(t) ? t : `${t.replace(" ", "T")}Z`).getTime();

const openNeedsWhere = (o: Owner) => and(eq(schema.forumNeeds.workspaceId, o.workspaceId), eq(schema.forumNeeds.userId, o.userId), isNull(schema.forumNeeds.doneAt));

async function settleNeeds(o: Owner, keep: (n: schema.ForumNeed) => boolean, by: "member" | "agent"): Promise<number> {
  const open = await db.query.forumNeeds.findMany({ where: openNeedsWhere(o) });
  const gone = open.filter((n) => !keep(n));
  if (!gone.length) return 0;
  const now = nowIso();
  await db.update(schema.forumNeeds).set({ doneAt: now, doneBy: by }).where(and(openNeedsWhere(o), inArray(schema.forumNeeds.id, gone.map((n) => n.id))));
  return gone.length;
}

/** A decision on H-N settles the items that name H-N. */
export const clearNeedsForRef = (o: Owner, ref: string): Promise<number> => settleNeeds(o, (n) => !new RegExp(`\\b${ref}\\b`).test(`${n.what} ${n.detail ?? ""}`), "member");
/** A "Merged PR #N" post settles the items that name #N. */
export const clearNeedsForPr = (o: Owner, pr: number): Promise<number> => settleNeeds(o, (n) => !needPrs(n.what, n.detail).includes(pr), "agent");

/**
 * Items already answered elsewhere go done (H-1494 §2 and §4): one naming an H-number that has its decision, or a PR a
 * "Merged PR #N" post reports. Runs on every read of the list, so what piled up before this settles on the first look.
 */
export async function sweepNeeds(o: Owner): Promise<number> {
  const open = await db.query.forumNeeds.findMany({ where: openNeedsWhere(o) });
  if (!open.length) return 0;
  const seqs = [...new Set(open.map((n) => needRef(n.what, n.detail)).filter((r): r is string => Boolean(r)).map((r) => Number(r.slice(2))))];
  const decided = new Set(seqs.length ? (await db.query.handoffMessages.findMany({ where: and(mine(o), inArray(schema.handoffMessages.seq, seqs), isNotNull(schema.handoffMessages.decision)), columns: { seq: true } })).map((m) => m.seq) : []);
  const prs = new Set(open.flatMap((n) => needPrs(n.what, n.detail)));
  const merged = new Set<number>();
  if (prs.size) for (const m of await db.query.handoffMessages.findMany({ where: and(mine(o), sql`${schema.handoffMessages.title} like 'Merged PR #%'`), columns: { title: true } })) {
    const k = /^Merged PR #(\d+)\b/i.exec(m.title);
    if (k && prs.has(Number(k[1]))) merged.add(Number(k[1]));
  }
  let n = 0;
  if (decided.size) n += await settleNeeds(o, (x) => { const r = needRef(x.what, x.detail); return r === null || !decided.has(Number(r.slice(2))); }, "member");
  if (merged.size) n += await settleNeeds(o, (x) => !needPrs(x.what, x.detail).some((p) => merged.has(p)), "agent");
  return n;
}

/** The open "needs you" items, oldest first, swept first. */
export async function openNeeds(o: Owner, now: Date = new Date()): Promise<OpenNeed[]> {
  await sweepNeeds(o);
  const [rows, agents] = await Promise.all([db.query.forumNeeds.findMany({ where: openNeedsWhere(o), orderBy: asc(schema.forumNeeds.createdAt) }), agentsOf(o)]);
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    agent: r.agentId ? (agents.find((a) => a.id === r.agentId)?.name ?? "A removed agent") : null,
    what: r.what,
    detail: r.detail,
    when: r.when,
    at: r.createdAt,
    ref: needRef(r.what, r.detail),
    stale: now.getTime() - sqlTime(r.createdAt) > NEED_STALE_MS,
  }));
}

/** The owner ticks an item on the Inbox or the Forum, done or not needed: either way it leaves the list. */
export async function tickNeed(o: Owner, id: string): Promise<boolean> {
  const done = await db.update(schema.forumNeeds).set({ doneAt: nowIso(), doneBy: "member" }).where(and(openNeedsWhere(o), eq(schema.forumNeeds.id, id))).returning({ id: schema.forumNeeds.id });
  return done.length > 0;
}

/** The three parts of the Inbox number, each by the query the Inbox lists with. */
export async function inboxCounts(o: Owner): Promise<{ waiting: number; needs: number; fresh: number }> {
  const [waiting] = await db.select({ n: sql<number>`count(*)` }).from(schema.handoffMessages).where(and(mine(o), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision), isNull(schema.handoffMessages.holdReason), isNull(schema.handoffMessages.supersededById)));
  const [needs] = await db.select({ n: sql<number>`count(*)` }).from(schema.forumNeeds).where(openNeedsWhere(o));
  const [fresh] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.handoffDeliveries)
    .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
    .where(and(mine(o), eq(schema.handoffDeliveries.recipient, DANNO), isNull(schema.handoffDeliveries.deliveredAt), eq(schema.handoffMessages.needsApproval, false)));
  return { waiting: Number(waiting?.n ?? 0), needs: Number(needs?.n ?? 0), fresh: Number(fresh?.n ?? 0) };
}

/** The Superseded tab (H-351): every replaced post, newest first, never deleted; `q` narrows by H-number, title or body. */
export async function supersededInbox(o: Owner, q = "", limit = 200): Promise<InboxItem[]> {
  const rows = await db.query.handoffMessages.findMany({ where: and(mine(o), isNotNull(schema.handoffMessages.supersededById)), orderBy: desc(schema.handoffMessages.seq), limit });
  const needle = q.trim().toLowerCase();
  const kept = needle ? rows.filter((r) => hId(r.seq).toLowerCase() === needle || r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle)) : rows;
  return describe(o, kept);
}

// ---------------------------------------------------------------------------------------------------------------------------
// H-351: HOLD and SUPERSEDED. The writing agent (through the tools) or the owner (signed in) sets them; nobody else.

/** A refusal the inbox says in its own words (H-351): the one kind of error the owner's screen may show; anything else is ours to log. */
export class HandoffRefusal extends Error {}
export const refusalOf = (e: unknown): string | null => (e instanceof HandoffRefusal ? e.message : null);

async function holdStateOf(o: Owner, row: schema.HandoffMessage): Promise<{ held: { reason: string; at: string } | null; supersededBy: string | null }> {
  let supersededBy: string | null = null;
  if (row.supersededById) {
    const by = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, row.supersededById)), columns: { seq: true } });
    supersededBy = by ? hId(by.seq) : "a newer post";
  }
  return { held: row.holdReason ? { reason: row.holdReason, at: row.heldAt ?? row.createdAt } : null, supersededBy };
}

/** The post, when it is this agent's own (or the caller is the owner, agentId null). */
async function ownPost(o: Owner, agentId: string | null, ref: unknown): Promise<schema.HandoffMessage> {
  const seq = parseHId(ref);
  const row = seq === null ? null : await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.seq, seq)) });
  if (!row) throw new HandoffRefusal(`There's no ${seq === null ? String(ref) : hId(seq)} in the inbox.`);
  if (agentId !== null && row.fromAgentId !== agentId) throw new HandoffRefusal(`${hId(row.seq)} isn't yours to change: only the agent that wrote it, or ${(await ownerOf(o)).first}, can.`);
  return row;
}

/** Hold: the post keeps its place in the list with "HOLD · Don't approve yet" and the reason; Approve goes until it is released. */
export async function holdHandoff(o: Owner, agentId: string | null, ref: unknown, reason: unknown): Promise<string> {
  const row = await ownPost(o, agentId, ref);
  const why = holdReason(reason);
  if (!why) throw new HandoffRefusal("Say why it's on hold, in one line (\"waiting on your H-336 decision\").");
  if (row.decision) throw new HandoffRefusal(`${hId(row.seq)} was already decided (${row.decision}); a hold changes nothing now.`);
  if (row.supersededById) throw new HandoffRefusal(`${hId(row.seq)} was replaced; hold the newer post instead.`);
  await db.update(schema.handoffMessages).set({ holdReason: why, heldAt: nowIso() }).where(eq(schema.handoffMessages.id, row.id));
  await audit(o, agentId, "hold", hId(row.seq), why);
  return `${hId(row.seq)} is on hold: ${why}. ${(await ownerOf(o)).first} can't approve it until it is released.`;
}

/** Release: Approve comes back, and the owner is told it is ready. */
export async function releaseHandoff(o: Owner, agentId: string | null, ref: unknown): Promise<string> {
  const row = await ownPost(o, agentId, ref);
  if (!row.holdReason) throw new HandoffRefusal(`${hId(row.seq)} isn't on hold.`);
  await db.update(schema.handoffMessages).set({ holdReason: null, heldAt: null }).where(eq(schema.handoffMessages.id, row.id));
  await audit(o, agentId, "release", hId(row.seq), null);
  if (row.needsApproval && !row.decision) {
    const agents = await agentsOf(o);
    await alertOwner(o, row, agents.find((a) => a.id === row.fromAgentId)?.name ?? "An agent");
  }
  return `${hId(row.seq)} is released${row.needsApproval && !row.decision ? ` and back in ${(await ownerOf(o)).first}'s Waiting list` : ""}.`;
}

/** Supersede: the old post moves to the Superseded tab, pointing at the newer one; it is never deleted. */
export async function supersedeHandoff(o: Owner, agentId: string | null, ref: unknown, byRef: unknown): Promise<string> {
  const row = await ownPost(o, agentId, ref);
  const bySeq = parseHId(byRef);
  const by = bySeq === null ? null : await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.seq, bySeq)) });
  if (!by) throw new HandoffRefusal(`There's no ${bySeq === null ? String(byRef) : hId(bySeq)} to point at.`);
  if (by.id === row.id) throw new HandoffRefusal("A post can't replace itself.");
  await db.update(schema.handoffMessages).set({ supersededById: by.id, holdReason: null, heldAt: null }).where(eq(schema.handoffMessages.id, row.id));
  await audit(o, agentId, "supersede", hId(row.seq), `by ${hId(by.seq)}`);
  return `${hId(row.seq)} is superseded by ${hId(by.seq)}: it moved to the Superseded tab with no Approve.`;
}

export async function markOwnerRead(o: Owner): Promise<void> {
  const ids = (await db.query.handoffMessages.findMany({ where: mine(o), columns: { id: true } })).map((r) => r.id);
  if (ids.length) await db.update(schema.handoffDeliveries).set({ deliveredAt: nowIso() }).where(and(inArray(schema.handoffDeliveries.messageId, ids), eq(schema.handoffDeliveries.recipient, DANNO), isNull(schema.handoffDeliveries.deliveredAt)));
}

/** How many plans and requests wait for the owner's decision: the Today line (H-727 PR 2). */
export async function waitingCount(o: Owner): Promise<number> {
  const [waiting] = await db.select({ n: sql<number>`count(*)` }).from(schema.handoffMessages).where(and(mine(o), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision), isNull(schema.handoffMessages.holdReason), isNull(schema.handoffMessages.supersededById)));
  return Number(waiting?.n ?? 0);
}

/** The Inbox number (H-1488): what waits on the owner (approvals and "needs you" items) plus the unread messages to them. */
export async function inboxCount(o: Owner): Promise<number> {
  const c = await inboxCounts(o);
  return c.waiting + c.needs + c.fresh;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Files: a short-lived link to upload straight into the private store; read back and checked before anyone can fetch it.

export async function startUpload(o: Owner, agentId: string, name: unknown, size: unknown): Promise<{ fileId: string; uploadUrl: string; contentType: string; expiresAt: string }> {
  const n = String(name ?? "").trim();
  const refusal = fileNameRefusal(n);
  if (refusal) {
    await audit(o, agentId, "file refused", null, "a key-like or bad file name");
    throw new Error(refusal);
  }
  const type = fileTypeFor(n);
  if (!type) throw new Error("Only images, video, zip, md, csv, json and pdf files travel through the inbox.");
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("Say the file's size in bytes.");
  if (bytes > HANDOFF_FILE_MAX_BYTES) throw new Error(`A file is at most ${HANDOFF_FILE_MAX_BYTES / 1024 / 1024} MB.`);
  if ((await usedBytes(o)) + bytes > HANDOFF_TOTAL_BYTES) {
    const who = await ownerOf(o);
    throw new Error(`The inbox's 1 GB of files is full. ${who.first} can delete old files on ${who.coach ? "Coach → Inbox" : "the Agent inbox"}.`);
  }
  const id = newId();
  const key = `handoff/${o.workspaceId}/${id}/${safeFileName(n)}`;
  const validUntil = Date.now() + HANDOFF_LINK_MINUTES * 60 * 1000;
  const uploadUrl = await presignHandoffUpload(key, type, HANDOFF_FILE_MAX_BYTES, validUntil);
  await db.insert(schema.handoffFiles).values({ id, ...o, agentId, name: n, contentType: type, size: bytes, key, status: "pending" });
  await audit(o, agentId, "upload link", id, n);
  return { fileId: id, uploadUrl, contentType: type, expiresAt: new Date(validUntil).toISOString() };
}

async function usedBytes(o: Owner): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${schema.handoffFiles.size}), 0)` }).from(schema.handoffFiles).where(and(eq(schema.handoffFiles.workspaceId, o.workspaceId), eq(schema.handoffFiles.userId, o.userId), ne(schema.handoffFiles.status, "rejected")));
  return Number(row?.n ?? 0);
}

const TEXT_TYPES = new Set(["text/markdown", "text/csv", "application/json"]);
const SCAN_BYTES = 5 * 1024 * 1024;

/**
 * A file read back from the store and checked once: there, within 100 MB, and clean. Text files (md, csv, json) are scanned
 * for anything key-like, and a zip's file names for .env, keys and credentials; anything caught is deleted and the reason kept.
 */
export async function readyFile(o: Owner, fileId: string, agentId: string | null): Promise<schema.HandoffFile> {
  const f = await db.query.handoffFiles.findFirst({ where: and(eq(schema.handoffFiles.workspaceId, o.workspaceId), eq(schema.handoffFiles.userId, o.userId), eq(schema.handoffFiles.id, String(fileId))) });
  if (!f) throw new Error(`There's no file ${String(fileId)} in the inbox.`);
  if (f.status === "ready") return f;
  if (f.status === "rejected") throw new Error(`That file was refused: ${f.reason ?? "it didn't pass the checks"}.`);
  let stored;
  try {
    stored = await headProofObject(f.key);
  } catch {
    throw new Error(`File ${f.id} hasn't arrived yet. PUT it to the upload link first (the link lasts ${HANDOFF_LINK_MINUTES} minutes).`);
  }
  const reject = async (reason: string) => {
    try {
      await deleteProofObject(stored.url);
    } catch {
      /* the row says rejected either way; the sweep can take the object */
    }
    await db.update(schema.handoffFiles).set({ status: "rejected", reason }).where(eq(schema.handoffFiles.id, f.id));
    await audit(o, agentId, "file refused", f.id, reason);
    throw new Error(`That file was refused and deleted: ${reason}.`);
  };
  if (stored.size > HANDOFF_FILE_MAX_BYTES) await reject(`it's bigger than the ${HANDOFF_FILE_MAX_BYTES / 1024 / 1024} MB a file may be`);
  if (TEXT_TYPES.has(f.contentType)) {
    const res = await readProofObject(stored.url, `bytes=0-${SCAN_BYTES - 1}`);
    const text = await res.text();
    if (text.split(/\s+/).some((w) => w && looksLikeSecret(w))) await reject("something in it looks like a key");
  }
  if (f.contentType === "application/zip") {
    const names = await zipNamesFromStore(stored.url, stored.size);
    if (!names) await reject("it isn't a readable zip");
    const bad = names!.map((x) => fileNameRefusal(x.split("/").pop() || x) ?? (/(^|\/)\.env/i.test(x) ? "env" : null)).find(Boolean);
    if (bad) await reject("a file inside looks like a key, a .env or credentials");
  }
  await db.update(schema.handoffFiles).set({ status: "ready", size: stored.size, readyAt: nowIso() }).where(eq(schema.handoffFiles.id, f.id));
  await audit(o, agentId, "file", f.id, f.name);
  return { ...f, status: "ready", size: stored.size };
}

/** A zip's names from its central directory, read by range from the store (the whole zip never loads). */
async function zipNamesFromStore(url: string, size: number): Promise<string[] | null> {
  const tailLen = Math.min(size, 65_557);
  const tail = new Uint8Array(await (await readProofObject(url, `bytes=${size - tailLen}-${size - 1}`)).arrayBuffer());
  const at = zipCentral(tail);
  if (!at) return null;
  if (at.offset + at.length > size) return null;
  const cd = new Uint8Array(await (await readProofObject(url, `bytes=${at.offset}-${at.offset + at.length - 1}`)).arrayBuffer());
  return zipCentral.names(cd, at.count);
}

/** handoff_file: a link that fetches the file for 15 minutes, for an agent that sent it or is in a thread that carries it. */
export async function fileLink(o: Owner, agentId: string | null, fileId: unknown): Promise<{ url: string; name: string; size: number; expiresAt: string }> {
  const f = await readyFile(o, String(fileId ?? ""), agentId);
  if (agentId && f.agentId !== agentId) {
    const carrying = await db.query.handoffMessages.findMany({ where: and(mine(o), sql`exists (select 1 from json_each(${schema.handoffMessages.fileIds}) where value = ${f.id})`) });
    if (!carrying.some((m) => m.fromAgentId === agentId || m.toIds.includes(agentId))) throw new Error("That file wasn't sent to this agent.");
  }
  const exp = Date.now() + HANDOFF_LINK_MINUTES * 60 * 1000;
  await audit(o, agentId, "file link", f.id, f.name);
  return { url: `${appUrl()}/api/handoff/files/${f.id}?exp=${exp}&sig=${fileSig(f.id, exp)}`, name: f.name, size: f.size, expiresAt: new Date(exp).toISOString() };
}

function signingKey(): string {
  const k = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  if (!k && process.env.NODE_ENV === "production") throw new Error("File links can't be signed right now.");
  return createHash("sha256").update(`handoff-file:${k ?? "dev-only"}`).digest("hex");
}
export const fileSig = (id: string, exp: number): string => createHmac("sha256", signingKey()).update(`${id}.${exp}`).digest("base64url");
export function fileSigOk(id: string, exp: string | null, sig: string | null): boolean {
  const n = Number(exp);
  if (!sig || !Number.isFinite(n) || n < Date.now() || n > Date.now() + HANDOFF_LINK_MINUTES * 60 * 1000 + 60_000) return false;
  return safeEqual(fileSig(id, n), sig);
}

export type { HandoffKind };

// ---------------------------------------------------------------------------------------------------------------------------
// Scheduled check-ins (Danno, 13 Oct). A timer on Danno's Claude account wakes each agent's session; the agent's first call is
// handoff_checkin, which answers work, reply, wait or quiet. Items are delivered (once) only when the act is work or reply.

export async function agentSettings(o: Owner, agentId: string): Promise<schema.HandoffAgent> {
  const where = and(eq(schema.handoffAgents.workspaceId, o.workspaceId), eq(schema.handoffAgents.userId, o.userId), eq(schema.handoffAgents.agentId, agentId));
  const had = await db.query.handoffAgents.findFirst({ where });
  if (had) return had;
  await db.insert(schema.handoffAgents).values({ id: newId(), ...o, agentId }).onConflictDoNothing();
  return (await db.query.handoffAgents.findFirst({ where }))!;
}

export type Checkin = { act: CheckinAct; line: string; items: InboxItem[]; waitingOn: string | null; lastStatus: string | null; count: number; /** This agent's "needs you" items open for more than three days (H-1494 §3): still needed? */ stale: string[] };

export async function checkinFor(o: Owner, agent: schema.ForumAgent, now: Date = new Date()): Promise<Checkin> {
  const s = await agentSettings(o, agent.id);
  const owner = await db.query.forumSettings.findFirst({ where: and(eq(schema.forumSettings.workspaceId, o.workspaceId), eq(schema.forumSettings.userId, o.userId)), columns: { checkinsPaused: true } });
  const day = todayInTz(s.tz, now);
  const count = s.countDay === day ? s.countToday : 0;
  const pending = await db
    .select({ m: schema.handoffMessages })
    .from(schema.handoffDeliveries)
    .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
    .where(and(mine(o), eq(schema.handoffDeliveries.recipient, agent.id), isNull(schema.handoffDeliveries.deliveredAt)))
    .orderBy(asc(schema.handoffMessages.seq));
  const asked = await db.query.handoffMessages.findMany({ where: and(mine(o), eq(schema.handoffMessages.fromAgentId, agent.id), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision)), orderBy: asc(schema.handoffMessages.seq), limit: 3 });
  const { first } = await ownerOf(o);
  const waitingOn = asked.map((m) => `${first}'s approval of ${hId(m.seq)}`);
  const decided = decideCheckin({
    enabled: s.checkins,
    paused: !!owner?.checkinsPaused,
    active: inActiveHours(now, { from: s.activeFrom, to: s.activeTo, days: s.activeDays, tz: s.tz }),
    countToday: count,
    busy: s.busyNote,
    items: pending.map((p) => ({ fromDanno: p.m.fromAgentId === null, decision: p.m.decision, urgent: p.m.urgent })),
    waitingOn,
    owner: first,
  });
  const counted = count >= CHECKINS_PER_DAY ? count : count + 1;
  await db.update(schema.handoffAgents).set({ lastCheckinAt: now.toISOString(), lastAct: decided.act, countDay: day, countToday: counted }).where(eq(schema.handoffAgents.id, s.id));
  await audit(o, agent.id, "check-in", null, decided.act);
  // A check-in is a sign of life: a stall the watch flagged ends here (H-495).
  if (agent.stalledAt) await heardFrom(o, agent);
  const items = decided.act === "work" || decided.act === "reply" ? await inboxFor(o, agent.id) : [];
  const fresh = await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, agent.id), columns: { now: true, last: true } });
  const stale = (await openNeeds(o, now)).filter((n) => n.agentId === agent.id && n.stale).map((n) => n.what);
  return { ...decided, items, waitingOn: decided.act === "wait" && waitingOn.length ? waitingOn.join(", ") : null, lastStatus: fresh?.now ?? fresh?.last ?? null, count: counted, stale };
}

/** handoff_busy: on with a note while a long job runs (its building shows it working on that), off when it ends. */
export async function setBusy(o: Owner, agent: schema.ForumAgent, on: boolean, note: unknown): Promise<string> {
  const s = await agentSettings(o, agent.id);
  const line = scrubText(String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 160)).text || "a long job";
  await db.update(schema.handoffAgents).set(on ? { busyNote: line, busySince: nowIso() } : { busyNote: null, busySince: null }).where(eq(schema.handoffAgents.id, s.id));
  if (on) await reportToForum(o, { agent: agent.name, status: "working", now: line }, "agent");
  await audit(o, agent.id, on ? "busy on" : "busy off", null, on ? line : null);
  return on ? `Busy: ${line}. Check-ins wait until you call handoff_busy off.` : "Not busy. Check-ins will hand you work again.";
}

/** The owner writes to an agent themselves (13 Oct), marked urgent when it must get past a busy check-in. Only from their own page. */
export async function writeAsOwner(o: Owner, agentId: string, kind: HandoffKind, title: string, body: string, urgent: boolean): Promise<boolean> {
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  const t = scrubText(cutText(title.replace(/\s+/g, " ").trim(), HANDOFF_MAX.title)).text;
  if (!agent || agent.builtIn || !t) return false;
  const row = await insertMessage(o, { fromAgentId: null, toIds: [agent.id], kind, title: t, body: scrubText(cutText(body.trim(), HANDOFF_MAX.body)).text, urgent }, [agent.id]);
  await audit(o, null, urgent ? "wrote (urgent)" : "wrote", hId(row.seq), t);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Start this agent (H-26 C): the coach sends an agent a reading pack, files and all, as one brief from Danno.

export const READING_PACK_FILE_MAX = 20 * 1024 * 1024;
/** The files are written from the server (a coach's form, not an agent's PUT), checked by the same name and type rules, and ready at once. */
export async function sendReadingPack(o: Owner, agentId: string, title: string, body: string, files: { name: string; bytes: Buffer; type?: string }[]): Promise<{ ok: true; seq: number } | { ok: false; text: string }> {
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!agent || agent.builtIn) return { ok: false, text: "Pick one of your agents." };
  const t = scrubText(cutText(title.replace(/\s+/g, " ").trim(), HANDOFF_MAX.title)).text || "Reading pack";
  if (files.length > HANDOFF_MAX.files) return { ok: false, text: `At most ${HANDOFF_MAX.files} files in one pack.` };
  const ids: string[] = [];
  for (const f of files) {
    const n = f.name.trim();
    const refusal = fileNameRefusal(n);
    if (refusal) return { ok: false, text: refusal };
    const type = fileTypeFor(n);
    if (!type) return { ok: false, text: `${n}: only images, video, zip, md, csv, json and pdf files travel through the inbox.` };
    if (!f.bytes.length || f.bytes.length > READING_PACK_FILE_MAX) return { ok: false, text: `${n}: a reading-pack file is at most ${READING_PACK_FILE_MAX / 1024 / 1024} MB.` };
    if ((await usedBytes(o)) + f.bytes.length > HANDOFF_TOTAL_BYTES) return { ok: false, text: "The inbox's 1 GB of files is full. Delete old files on Coach → Inbox." };
    if (TEXT_TYPES.has(type) && f.bytes.subarray(0, SCAN_BYTES).toString("utf8").split(/\s+/).some((w) => w && looksLikeSecret(w))) return { ok: false, text: `${n} looks like it holds a key or credentials. Keys never travel through the inbox.` };
    const id = newId();
    const key = `handoff/${o.workspaceId}/${id}/${safeFileName(n)}`;
    await putHandoffObject(key, f.bytes, type);
    await db.insert(schema.handoffFiles).values({ id, ...o, agentId: null, name: n, contentType: type, size: f.bytes.length, key, status: "ready", readyAt: nowIso() });
    ids.push(id);
  }
  const row = await insertMessage(o, { fromAgentId: null, toIds: [agent.id], kind: "brief", title: t, body: scrubText(cutText(body.trim(), HANDOFF_MAX.body)).text, fileIds: ids }, [agent.id]);
  await audit(o, null, "reading pack", hId(row.seq), `${t} (${ids.length} file${ids.length === 1 ? "" : "s"})`);
  return { ok: true, seq: row.seq };
}
