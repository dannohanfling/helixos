/**
 * The Stage 1 push to a client's own Community Loyalty (uChat) workspace: HelixOS writes values into the template's existing
 * bot field names, one call per client, addressed by name (PUT /flow/set-bot-fields-by-name). One-way: the only read is the
 * read-back of what was just sent. The push is a named subset (STAGE1_FIELDS) and asserts it touches none of
 * BOT_WRITTEN_FIELDS before it sends, so a re-push after an unrelated edit leaves the calendar the client chose and the
 * appointment the agent booked exactly as they were.
 *
 * Request shape from the published UChat OpenAPI document (code-addendum-uchat-spec.md): `{ "data": [{ name, value }] }` with
 * `Authorization: Bearer <token>`, a 200 of `{ "status": "ok" }` with no per-field result. So a 200 is not a match: after it,
 * GET /flow/bot-fields is read, page by page at an explicit limit until a page comes back short, and compared; the push is
 * recorded only when every sent value reads back. The read-back's shape is the spec's BotFieldResource (`{ data: [BotField] }`,
 * each with name, var_type and a string value), parsed and nothing else. Comparison is exact: a typed field the bot normalises
 * ("01" to "1") fails the match on the safe side until the live call says how it behaves. Partial failure and the host are
 * Danno's call to run. Tokens are sealed at rest and decrypted for the request.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { BOT_WRITTEN_FIELDS, READ_BACK_LIMIT, STAGE1_FIELDS, assertStorable, botFieldsRequest, morePages, parseBotFields, readBackMismatches, samePayload, stage1Payload, stage1Problems, type BotFieldPayload } from "@/lib/engine/bot-fields";
import { redactSecrets } from "@/lib/engine/redact";
import { logSync } from "@/lib/integrations";

const DEFAULT_BASE = "https://www.uchat.com.au/api";
export function uchatBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.UCHAT_BASE_URL ? process.env.UCHAT_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export type PushOutcome = { status: "sent" | "skipped" | "failed"; note: string; fields: string[] };

/** The Stage 1 payload for one member, read off the record: the membership, the workspace, the member's zone and their live offers. */
export async function payloadFor(membership: schema.Membership): Promise<BotFieldPayload> {
  const [workspace, offers] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, membership.workspaceId), eq(schema.offers.userId, membership.userId)) }),
  ]);
  // The member's own zone, else the workspace's: the same rule Today and the reminders follow.
  return stage1Payload({ businessName: membership.businessName, workspaceName: workspace?.name ?? "", timezone: membership.timezone ?? workspace?.timezone ?? "UTC", offers });
}

/**
 * Push one member's Stage 1 fields. `force` re-sends even when nothing changed (the coach's Re-sync, which wins back fields the
 * bot's own SETUP wizard overwrote); otherwise an unchanged payload is not sent. Never throws.
 */
export async function pushBotFields(membershipId: string, opts: { force?: boolean; reason: string }): Promise<PushOutcome> {
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  if (!m) return { status: "skipped", note: "No such member.", fields: [] };
  const log = async (status: PushOutcome["status"], note: string, fields: string[]) => {
    // The sync log carries the names and the reason, never a value: values are on the membership row, the token nowhere.
    await logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "community_loyalty", direction: "out", event: "botfields.push", payload: { reason: opts.reason, fields }, status, note: redactSecrets(note) });
    return { status, note, fields };
  };
  const token = open(m.clApiToken);
  if (!token) return log("skipped", "No Community Loyalty API token on this client.", []);
  const payload = await payloadFor(m);
  const names = Object.keys(payload);
  for (const n of names) if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(n) || !(STAGE1_FIELDS as readonly string[]).includes(n)) return log("failed", `Refused: ${n} is not a Stage 1 field.`, names);
  // The drip webhook is never opened here: its shape (/api/iwh/) is refused by assertStorable without the value in hand.
  assertStorable(payload, [token]);
  const problems = stage1Problems(payload);
  if (problems.length) return log("failed", problems.join(" "), names);
  if (!opts.force && samePayload(m.clBotFields, payload)) return log("skipped", "Nothing changed since the last push.", names);
  try {
    const headers = { "content-type": "application/json", accept: "application/json", Authorization: `Bearer ${token}` };
    const withTimeout = async (input: string, init: RequestInit) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        return await fetch(input, { ...init, signal: ctrl.signal });
      } finally {
        clearTimeout(t);
      }
    };
    const res = await withTimeout(`${uchatBase()}/flow/set-bot-fields-by-name`, { method: "PUT", headers, body: JSON.stringify(botFieldsRequest(payload)) });
    const text = (await res.text()).slice(0, 200);
    if (!res.ok) return log("failed", `${res.status} ${text}`.trim(), names);
    // Read back: a 200 says the call was accepted, not that the fields were written. The record moves only on a match.
    const held: Record<string, string | undefined> = {};
    for (let page = 1; page <= 100; page++) {
      const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers });
      if (!back.ok) return log("failed", `Pushed, but the read-back answered ${back.status} on page ${page}: not recorded as synced.`, names);
      const rows = parseBotFields(await back.json());
      for (const r of rows) held[r.name] = r.value;
      if (!morePages(rows.length, READ_BACK_LIMIT)) break;
    }
    const mismatched = readBackMismatches(payload, held);
    if (mismatched.length) return log("failed", `Pushed, but the read-back differs on ${mismatched.join(", ")}: not recorded as synced.`, names);
    await db.update(schema.memberships).set({ clBotFields: payload, clBotFieldsPushedAt: nowIso() }).where(eq(schema.memberships.id, m.id));
    return log("sent", `${names.length} fields pushed and read back`, names);
  } catch (e) {
    return log("failed", e instanceof Error ? e.message : String(e), names);
  }
}

/** A Stage 1 source changed for one member: re-push if the payload differs. Quiet when the member has no token. */
export async function repushForMember(workspaceId: string, userId: string, reason: string): Promise<void> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) });
  if (m?.clApiToken) await pushBotFields(m.id, { reason });
}

/** A workspace-wide source changed (its timezone): every member with a token is re-pushed. */
export async function repushWorkspace(workspaceId: string, reason: string): Promise<void> {
  const members = await db.query.memberships.findMany({ where: eq(schema.memberships.workspaceId, workspaceId) });
  for (const m of members) if (m.clApiToken) await pushBotFields(m.id, { reason });
}

/* ───────────── The coach's brain: the approved FAQ composed into one longtext field, pushed only where the agent reads it ───────────── */

import { FAQ_BOT_FIELD_DEFAULT, FAQ_FIELD_BUDGET, agentReadsFields, composeField, notReadWarning, parseAgentInfo, parseAgents, rankEntries, type AgentInfo } from "@/lib/engine/faq";
import { newId } from "@/lib/ids";

const APPROVED = ["ai_accepted", "edited", "coach"] as const;
/** An entry the Bot Brief has approved: accepted, edited (an edit is a review) or the coach's own words. Never ai_unreviewed. */
export const isApprovedOrigin = (origin: string | null | undefined): boolean => (APPROVED as readonly string[]).includes(origin ?? "");

async function withTimeout(input: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
const authed = (token: string) => ({ "content-type": "application/json", accept: "application/json", Authorization: `Bearer ${token}` });

/** GET /flow/ai-agents: the agents in the client's workspace, ns and name. Empty on any refusal. */
export async function listAgents(token: string): Promise<{ ns: string; name: string }[]> {
  try {
    const res = await withTimeout(`${uchatBase()}/flow/ai-agents`, { method: "GET", headers: authed(token) });
    return res.ok ? parseAgents(await res.json()) : [];
  } catch {
    return [];
  }
}

/** POST /flow/ai-agent-info: the one agent, its prompts harvested for the tokens it reads. Null on any refusal. */
export async function readAgentInfo(token: string, ns: string): Promise<AgentInfo | null> {
  try {
    const res = await withTimeout(`${uchatBase()}/flow/ai-agent-info`, { method: "POST", headers: authed(token), body: JSON.stringify({ ai_agent_ns: ns }) });
    return res.ok ? parseAgentInfo(await res.json()) : null;
  } catch {
    return null;
  }
}

/** The agent the Brief reads and pushes to: the one the coach chose on the member, else the workspace's first. */
export async function agentFor(m: schema.Membership, token: string): Promise<AgentInfo | null> {
  const ns = m.clAgentNs?.trim() || (await listAgents(token))[0]?.ns;
  return ns ? readAgentInfo(token, ns) : null;
}

/** The field name this member's FAQ composes into: their override, else the default the Booking Agent reads. */
export const faqFieldFor = (m: schema.Membership): string => m.faqBotField?.trim() || FAQ_BOT_FIELD_DEFAULT;

export type FaqPushOutcome = { status: "sent" | "skipped" | "failed"; note: string; syncId: string | null; dropped: string[]; reads: string[]; notRead: string[] };

/**
 * Push one member's approved FAQ into the one longtext field, on the Bot Brief's "Approve and send to my bot". Before the
 * push the target agent is read and the push goes only if its prompt reads the field; otherwise it is refused with the plain
 * warning. After the push both halves are read back — the field's value matches, and the token is still in the agent's prompt —
 * and only then is the sync recorded as sent; a failed one is kept with its reason. The composed text is whole entries under the
 * single budget; the lowest-ranked past it are dropped whole and listed. Never throws.
 */
export async function pushFaq(membershipId: string, opts: { reason: string; sentBy: string }): Promise<FaqPushOutcome> {
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  if (!m) return { status: "skipped", note: "No such member.", syncId: null, dropped: [], reads: [], notRead: [] };
  const field = faqFieldFor(m);
  const done = async (status: FaqPushOutcome["status"], note: string, extra: Partial<Omit<FaqPushOutcome, "status" | "note">> = {}, record?: { chars: number; entryCount: number; dropped: string[]; snapshot: { id: string; question: string; answer: string }[]; valueReadBack: boolean; tokenReadBack: boolean }) => {
    let syncId: string | null = null;
    if (record && status !== "skipped") {
      syncId = newId();
      await db.insert(schema.faqSyncs).values({ id: syncId, workspaceId: m.workspaceId, userId: m.userId, membershipId: m.id, fieldName: field, budget: FAQ_FIELD_BUDGET, chars: record.chars, entryCount: record.entryCount, dropped: record.dropped, snapshot: record.snapshot, valueReadBack: record.valueReadBack, tokenReadBack: record.tokenReadBack, status: status === "sent" ? "sent" : "failed", note: redactSecrets(note), sentBy: opts.sentBy });
    }
    // The sync log carries the field name, the count and the reason, never an answer's words and never the token.
    await logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "community_loyalty", direction: "out", event: "faq.push", payload: { reason: opts.reason, field, entries: record?.entryCount ?? 0, dropped: record?.dropped.length ?? 0, syncId }, status, note: redactSecrets(note) });
    return { status, note, syncId, dropped: extra.dropped ?? [], reads: extra.reads ?? [], notRead: extra.notRead ?? [] };
  };
  const token = open(m.clApiToken);
  if (!token) return done("skipped", "No Community Loyalty API token on this client. Ask your coach to add it.");
  // Never the calendar or a booking, and never a Stage 1 field: the FAQ has its own field or it does not go.
  if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(field) || (STAGE1_FIELDS as readonly string[]).includes(field)) return done("failed", `Refused: ${field} is written by the bot or by the Stage 1 push; the FAQ needs its own field.`);

  const rows = await db.query.faqEntries.findMany({ where: and(eq(schema.faqEntries.workspaceId, m.workspaceId), eq(schema.faqEntries.userId, m.userId)) });
  const approved = rows.filter((r) => isApprovedOrigin(r.origin));
  if (!approved.length) return done("skipped", "Nothing approved yet: accept at least one answer on the Brief first.");
  const composed = composeField(rankEntries(approved));
  const snapshot = composed.included.map((e) => ({ id: e.id, question: e.question, answer: e.answer }));
  const dropped = composed.dropped.map((e) => e.question);
  const record = { chars: composed.chars, entryCount: composed.included.length, dropped, snapshot, valueReadBack: false, tokenReadBack: false };

  // Push only what the agent reads: the target agent's prompt must carry the field's token, or the push is refused.
  const agent = await agentFor(m, token);
  if (!agent) return done("failed", "Couldn't read your bot's agent from Community Loyalty. Check the token and the agent, then try again.", {}, record);
  const { reads, notRead } = agentReadsFields(agent, [field]);
  if (!reads.length) return done("failed", `Not sent: ${notReadWarning(field)}. The agent "${agent.name}" reads none of it, so the answers would change nothing the bot does.`, { reads, notRead, dropped }, record);

  assertStorable({ [field]: composed.text }, [token]);
  try {
    const res = await withTimeout(`${uchatBase()}/flow/set-bot-fields-by-name`, { method: "PUT", headers: authed(token), body: JSON.stringify({ data: [{ name: field, value: composed.text }] }) });
    const text = (await res.text()).slice(0, 200);
    if (!res.ok) return done("failed", `${res.status} ${text}`.trim(), { reads, notRead, dropped }, record);
    // Read back, both halves: the value the bot holds, and the token still in the agent's prompt.
    let held: string | undefined;
    for (let page = 1; page <= 100; page++) {
      const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers: authed(token) });
      if (!back.ok) return done("failed", `Pushed, but the read-back answered ${back.status} on page ${page}: not recorded as synced.`, { reads, notRead, dropped }, record);
      const pageRows = parseBotFields(await back.json());
      const hit = pageRows.find((r) => r.name === field);
      if (hit) held = hit.value;
      if (!morePages(pageRows.length, READ_BACK_LIMIT)) break;
    }
    const valueReadBack = held === composed.text;
    const again = await agentFor(m, token);
    const tokenReadBack = Boolean(again && agentReadsFields(again, [field]).reads.length);
    const rec = { ...record, valueReadBack, tokenReadBack };
    if (!valueReadBack) return done("failed", `Pushed, but the read-back of ${field} differs: not recorded as synced.`, { reads, notRead, dropped }, rec);
    if (!tokenReadBack) return done("failed", `Pushed and the value reads back, but the token {${field}} is no longer in the agent's prompt: not recorded as synced.`, { reads, notRead, dropped }, rec);
    return done("sent", `${composed.included.length} answers sent (${composed.chars.toLocaleString()} of ${FAQ_FIELD_BUDGET.toLocaleString()} characters)${dropped.length ? `; ${dropped.length} dropped past the budget` : ""}, read back and matched.`, { reads, notRead, dropped }, rec);
  } catch (e) {
    return done("failed", e instanceof Error ? e.message : String(e), { reads, notRead, dropped }, record);
  }
}

/**
 * What the Bot Brief needs to know about a member's bot without ever holding the token itself: whether a token is on the
 * member, and the target agent read through it. The token is opened here and nowhere the page can reach.
 */
export async function briefAccessFor(m: schema.Membership): Promise<{ hasToken: boolean; agent: AgentInfo | null }> {
  const token = open(m.clApiToken);
  if (!token) return { hasToken: false, agent: null };
  return { hasToken: true, agent: await agentFor(m, token) };
}
