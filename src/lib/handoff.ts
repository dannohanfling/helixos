/**
 * The Handoff inbox (rev 769), the database side. The owner is the coach (Danno); members get theirs later, behind a switch.
 * An agent is one of the owner's Forum agents, and its identity is its token or its tied connection, never a name typed in a
 * message. Agents post, read, ack and move files; only the owner decides, by hand, signed in (`decideHandoff` is called from
 * the coach's own actions and nowhere else). A decision is one answer "from Danno", delivered once in the sender's next
 * handoff_inbox. Every post, file, ack, decision and token change is in the audit.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
import { forumNameKey, looksLikeSecret } from "@/lib/engine/forum";
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
} from "@/lib/engine/handoff";

export type Owner = { workspaceId: string; userId: string };
const mine = (o: Owner) => and(eq(schema.handoffMessages.workspaceId, o.workspaceId), eq(schema.handoffMessages.userId, o.userId));
const agentsOf = (o: Owner) => db.query.forumAgents.findMany({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId)) });

export async function audit(o: Owner, agentId: string | null, action: string, ref: string | null = null, note: string | null = null): Promise<void> {
  await db.insert(schema.handoffAudit).values({ id: newId(), ...o, agentId, action, ref, note: note ? note.slice(0, 300) : null, at: nowIso() });
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

/** A bearer agent token to its live token row and connection, or null. Only a token of the right shape is looked up. */
export async function agentTokenRow(token: string): Promise<{ tokenId: string; appId: string } | null> {
  if (!/^hxa_[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const hash = hashSecret(token);
  const row = await db.query.agentTokens.findFirst({ where: eq(schema.agentTokens.tokenHash, hash) });
  if (!row || row.revokedAt || !safeEqual(row.tokenHash, hash)) return null;
  await db.update(schema.agentTokens).set({ lastUsedAt: nowIso() }).where(eq(schema.agentTokens.id, row.id));
  return { tokenId: row.id, appId: row.appId };
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
  if (!agentId) throw new Error("This connection isn't tied to an agent, so it can't use the inbox. Danno ties it on Coach → Agents.");
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  if (!agent) throw new Error("This connection's agent is no longer on the Forum. Danno can tie it to another on Coach → Agents.");
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
    else throw new Error(`There's no agent called "${name}" on the Forum. Send to one of: ${["danno", ...agents.filter((a) => !a.builtIn).map((a) => a.name)].join(", ")}.`);
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
  const row = await insertMessage(o, { fromAgentId: from.id, toIds: [...new Set(to)], kind: p.kind, title: p.title, body: p.body, replyToId, threadId, fileIds: p.files, needsApproval: reasons.length > 0, approvalReasons: reasons, claimsApproval: claimsApproval(text) }, [...new Set(to)]);
  await audit(o, from.id, "post", hId(row.seq), p.title);
  // A status message updates the sender's Forum building.
  if (p.kind === "status") await reportToForum(o, { agent: from.name, status: "working", now: p.title }, "agent");
  // The road lights on its own (H-19): a flow to each recipient, the title as its label; a reply walks back the same road.
  const names = [...new Set(to)].map((id) => (id === DANNO ? "you" : (agents.find((a) => a.id === id)?.name ?? null))).filter((n): n is string => Boolean(n));
  await drawFlows(o, from, names, p.title, p.replyTo !== null, hId(row.seq));
  if (reasons.length) await alertOwner(o, row, from.name);
  return { id: row.id, seq: row.seq, needsApproval: reasons.length > 0, reasons, removed: p.removed };
}

/** The owner's email when something needs their approval (rev 816: email now, push later), behind their switch and canEmail. */
export async function alertOwner(o: Owner, row: schema.HandoffMessage, fromName: string): Promise<void> {
  const settings = await db.query.forumSettings.findFirst({ where: and(eq(schema.forumSettings.workspaceId, o.workspaceId), eq(schema.forumSettings.userId, o.userId)), columns: { approvalEmails: true } });
  if (settings && !settings.approvalEmails) return;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)) });
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, o.userId) });
  if (!m || !u || !(await canEmail(m.id))) return;
  // The title only: an agent's body never goes out by email.
  await sendEmail(u.email, `${hId(row.seq)} needs your approval`, `${fromName} posted ${hId(row.seq)}, "${row.title}", and it needs your approval (${row.approvalReasons.join(", ")}).\n\nOpen your inbox: ${appUrl()}/coach/inbox\n\nTurn these emails off on Coach → Inbox.`);
}

export type InboxItem = { id: string; ref: string; kind: string; from: string; to: string[]; title: string; body: string; replyTo: string | null; files: { id: string; name: string; size: number }[]; needsApproval: boolean; reasons: string[]; claimsApproval: boolean; decision: string | null; decisionFor: string | null; decidedAt: string | null; fromDanno: boolean; at: string };

async function describe(o: Owner, rows: schema.HandoffMessage[]): Promise<InboxItem[]> {
  const agents = await agentsOf(o);
  const name = (id: string | null) => (id === null || id === DANNO ? "Danno" : (agents.find((a) => a.id === id)?.name ?? "A removed agent"));
  const fileIds = [...new Set(rows.flatMap((r) => r.fileIds))];
  const files = fileIds.length ? await db.query.handoffFiles.findMany({ where: and(eq(schema.handoffFiles.workspaceId, o.workspaceId), eq(schema.handoffFiles.userId, o.userId), inArray(schema.handoffFiles.id, fileIds)) }) : [];
  const parents = new Map<string, number>();
  const parentIds = [...new Set(rows.map((r) => r.replyToId ?? r.decisionForId).filter(Boolean) as string[])];
  if (parentIds.length) for (const p of await db.query.handoffMessages.findMany({ where: inArray(schema.handoffMessages.id, parentIds), columns: { id: true, seq: true } })) parents.set(p.id, p.seq);
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
    at: r.createdAt,
  }));
}

/**
 * handoff_inbox: what's new for this agent, oldest first, each delivered once. Approvals come as Danno's answers among them,
 * marked with the decision (only Danno's signed-in action makes one).
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
  const line = scrubText(String(note ?? "").replace(/\s+/g, " ").trim().slice(0, HANDOFF_MAX.note)).text || null;
  const done = await db.update(schema.handoffDeliveries).set({ ackedAt: nowIso(), ackNote: line, deliveredAt: sql`coalesce(${schema.handoffDeliveries.deliveredAt}, ${nowIso()})` }).where(and(eq(schema.handoffDeliveries.messageId, row.id), eq(schema.handoffDeliveries.recipient, agentId))).returning({ id: schema.handoffDeliveries.id });
  if (!done.length) throw new Error(`${hId(row.seq)} wasn't sent to this agent, so there's nothing to ack.`);
  await audit(o, agentId, "ack", hId(row.seq), line);
  return `${hId(row.seq)} marked seen${line ? `: ${line}` : ""}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Decisions: only the owner, only by hand. Called from the coach's signed-in actions; no connector tool reaches this.

export async function decideHandoff(o: Owner, actorUserId: string, messageId: string, decision: "approved" | "changed" | "declined", note: string): Promise<{ ok: boolean; text: string }> {
  const row = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, messageId)) });
  if (!row || !row.needsApproval) return { ok: false, text: "That message isn't waiting for a decision." };
  if (decision === "changed" && !note.trim()) return { ok: false, text: "Say what to change." };
  const now = nowIso();
  // One tap per decision: only the first lands.
  const claimed = await db.update(schema.handoffMessages).set({ decision, decisionNote: note || null, decidedAt: now, decidedBy: actorUserId }).where(and(eq(schema.handoffMessages.id, row.id), isNull(schema.handoffMessages.decision))).returning({ id: schema.handoffMessages.id });
  if (!claimed.length) return { ok: false, text: `${hId(row.seq)} was already decided.` };
  const word = decision === "approved" ? "Approved" : decision === "changed" ? "Change" : "Declined";
  const to = row.fromAgentId ? [row.fromAgentId] : [];
  await insertMessage(o, { fromAgentId: null, toIds: to, kind: "answer", title: `${word}: ${hId(row.seq)} ${row.title}`.slice(0, HANDOFF_MAX.title), body: scrubText(note.slice(0, HANDOFF_MAX.change)).text, replyToId: row.id, threadId: row.threadId ?? row.id, decision, decidedAt: now, decidedBy: actorUserId, decisionForId: row.id }, to);
  await audit(o, null, decision === "approved" ? "approve" : decision === "changed" ? "change" : "decline", hId(row.seq), note || null);
  return { ok: true, text: `${word}: ${hId(row.seq)}. ${row.fromAgentId ? "It reaches the agent in its next inbox check." : ""}` };
}

/** Danno's own answer to a message, without a decision. */
export async function answerHandoff(o: Owner, messageId: string, body: string): Promise<boolean> {
  const row = await db.query.handoffMessages.findFirst({ where: and(mine(o), eq(schema.handoffMessages.id, messageId)) });
  const text = scrubText(body.trim().slice(0, HANDOFF_MAX.body)).text;
  if (!row || !text || !row.fromAgentId) return false;
  const answer = await insertMessage(o, { fromAgentId: null, toIds: [row.fromAgentId], kind: "answer", title: `Re: ${row.title}`.slice(0, HANDOFF_MAX.title), body: text, replyToId: row.id, threadId: row.threadId ?? row.id }, [row.fromAgentId]);
  await audit(o, null, "answer", hId(answer.seq));
  return true;
}

/** The owner's view: messages newest first, the waiting decisions, and the menu count (waiting decisions and unread for Danno). */
export async function ownerInbox(o: Owner, limit = 60): Promise<{ items: InboxItem[]; waiting: InboxItem[]; acks: Map<string, { recipient: string; note: string | null; at: string }[]> }> {
  const rows = await db.query.handoffMessages.findMany({ where: mine(o), orderBy: desc(schema.handoffMessages.seq), limit });
  const waitingRows = await db.query.handoffMessages.findMany({ where: and(mine(o), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision)), orderBy: asc(schema.handoffMessages.seq) });
  const deliveries = rows.length ? await db.query.handoffDeliveries.findMany({ where: inArray(schema.handoffDeliveries.messageId, rows.map((r) => r.id)) }) : [];
  const agents = await agentsOf(o);
  const acks = new Map<string, { recipient: string; note: string | null; at: string }[]>();
  for (const d of deliveries) if (d.ackedAt) acks.set(d.messageId, [...(acks.get(d.messageId) ?? []), { recipient: d.recipient === DANNO ? "Danno" : (agents.find((a) => a.id === d.recipient)?.name ?? "An agent"), note: d.ackNote, at: d.ackedAt }]);
  return { items: await describe(o, rows), waiting: await describe(o, waitingRows), acks };
}

export async function markOwnerRead(o: Owner): Promise<void> {
  const ids = (await db.query.handoffMessages.findMany({ where: mine(o), columns: { id: true } })).map((r) => r.id);
  if (ids.length) await db.update(schema.handoffDeliveries).set({ deliveredAt: nowIso() }).where(and(inArray(schema.handoffDeliveries.messageId, ids), eq(schema.handoffDeliveries.recipient, DANNO), isNull(schema.handoffDeliveries.deliveredAt)));
}

export async function inboxCount(o: Owner): Promise<number> {
  const [waiting] = await db.select({ n: sql<number>`count(*)` }).from(schema.handoffMessages).where(and(mine(o), eq(schema.handoffMessages.needsApproval, true), isNull(schema.handoffMessages.decision)));
  const [unread] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.handoffDeliveries)
    .innerJoin(schema.handoffMessages, eq(schema.handoffMessages.id, schema.handoffDeliveries.messageId))
    .where(and(mine(o), eq(schema.handoffDeliveries.recipient, DANNO), isNull(schema.handoffDeliveries.deliveredAt), eq(schema.handoffMessages.needsApproval, false)));
  return Number(waiting?.n ?? 0) + Number(unread?.n ?? 0);
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
  if ((await usedBytes(o)) + bytes > HANDOFF_TOTAL_BYTES) throw new Error("The inbox's 1 GB of files is full. Danno can delete old files on Coach → Inbox.");
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

export type Checkin = { act: CheckinAct; line: string; items: InboxItem[]; waitingOn: string | null; lastStatus: string | null; count: number };

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
  const waitingOn = asked.map((m) => `Danno's approval of ${hId(m.seq)}`);
  const decided = decideCheckin({
    enabled: s.checkins,
    paused: !!owner?.checkinsPaused,
    active: inActiveHours(now, { from: s.activeFrom, to: s.activeTo, days: s.activeDays, tz: s.tz }),
    countToday: count,
    busy: s.busyNote,
    items: pending.map((p) => ({ fromDanno: p.m.fromAgentId === null, decision: p.m.decision, urgent: p.m.urgent })),
    waitingOn,
  });
  const counted = count >= CHECKINS_PER_DAY ? count : count + 1;
  await db.update(schema.handoffAgents).set({ lastCheckinAt: now.toISOString(), lastAct: decided.act, countDay: day, countToday: counted }).where(eq(schema.handoffAgents.id, s.id));
  await audit(o, agent.id, "check-in", null, decided.act);
  const items = decided.act === "work" || decided.act === "reply" ? await inboxFor(o, agent.id) : [];
  const fresh = await db.query.forumAgents.findFirst({ where: eq(schema.forumAgents.id, agent.id), columns: { now: true, last: true } });
  return { ...decided, items, waitingOn: decided.act === "wait" && waitingOn.length ? waitingOn.join(", ") : null, lastStatus: fresh?.now ?? fresh?.last ?? null, count: counted };
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

/** Danno writes to an agent himself (13 Oct), marked urgent when it must get past a busy check-in. Only from his own page. */
export async function writeAsOwner(o: Owner, agentId: string, kind: HandoffKind, title: string, body: string, urgent: boolean): Promise<boolean> {
  const agent = await db.query.forumAgents.findFirst({ where: and(eq(schema.forumAgents.workspaceId, o.workspaceId), eq(schema.forumAgents.userId, o.userId), eq(schema.forumAgents.id, agentId)) });
  const t = scrubText(title.replace(/\s+/g, " ").trim().slice(0, HANDOFF_MAX.title)).text;
  if (!agent || agent.builtIn || !t) return false;
  const row = await insertMessage(o, { fromAgentId: null, toIds: [agent.id], kind, title: t, body: scrubText(body.trim().slice(0, HANDOFF_MAX.body)).text, urgent }, [agent.id]);
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
  const t = scrubText(title.replace(/\s+/g, " ").trim().slice(0, HANDOFF_MAX.title)).text || "Reading pack";
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
  const row = await insertMessage(o, { fromAgentId: null, toIds: [agent.id], kind: "brief", title: t, body: scrubText(body.trim().slice(0, HANDOFF_MAX.body)).text, fileIds: ids }, [agent.id]);
  await audit(o, null, "reading pack", hId(row.seq), `${t} (${ids.length} file${ids.length === 1 ? "" : "s"})`);
  return { ok: true, seq: row.seq };
}
