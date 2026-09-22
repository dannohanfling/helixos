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
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
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

/* ───────────── The coach's brain: the approved FAQ composed into one text field, pushed only where the agent reads it ───────────── */

import { FAQ_BOT_FIELD_DEFAULT, FAQ_FIELD_BUDGET, agentReadsFields, chooseAgentLine, composeField, faqFieldRefusal, fieldMissingLine, holdsForeignText, notReadWarning, parseAgentInfo, parseAgents, pickAgent, rankEntries, type AgentInfo } from "@/lib/engine/faq";
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

/**
 * GET /flow/ai-agents: the agents in the client's workspace, ns and name. Empty on any refusal.
 *
 * Cached for a minute per bot (keyed by a hash of its token, never the token), because the Coach page and the Bot Brief read it
 * on every render, prefetches included, and an agent list does not move minute to minute. A refusal is never cached. `fresh`
 * skips the cache: the check before a push and the read-back after it always read live (ruling, 22 Sep), since a minute-old
 * answer there is a correctness bug, not a performance trade.
 */
export const AGENT_LIST_TTL_MS = 60_000;
const agentLists = new Map<string, { at: number; agents: { ns: string; name: string }[] }>();
const botKey = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 24);
export async function listAgents(token: string, opts: { fresh?: boolean } = {}): Promise<{ ns: string; name: string }[]> {
  const key = botKey(token);
  const hit = agentLists.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < AGENT_LIST_TTL_MS) return hit.agents;
  try {
    const res = await withTimeout(`${uchatBase()}/flow/ai-agents`, { method: "GET", headers: authed(token) });
    if (!res.ok) {
      agentLists.delete(key);
      return [];
    }
    const agents = parseAgents(await res.json());
    agentLists.set(key, { at: Date.now(), agents });
    return agents;
  } catch {
    agentLists.delete(key);
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

/**
 * The agent the Brief reads and pushes to. The coach chooses it on the Coach page; blank never silently means "the first one",
 * because the agent that answers questions is not always the first (on the Book 'em Danno template the Booking Agent only
 * books). Blank with exactly one agent is no choice at all, so it is taken; blank with more than one asks.
 */
export async function agentFor(m: schema.Membership, token: string, opts: { fresh?: boolean } = {}): Promise<{ agent: AgentInfo | null; ask: string | null }> {
  const pick = pickAgent(m.clAgentNs, await listAgents(token, opts));
  if (pick.kind === "ask") return { agent: null, ask: chooseAgentLine(pick.agents) };
  if (pick.kind === "none") return { agent: null, ask: "No agent on your bot yet, so there is nothing for the FAQ to feed." };
  const agent = await readAgentInfo(token, pick.ns);
  // A cached list that names an agent the bot no longer answers for is stale: read the list again, once, rather than wait it out.
  if (!agent && !opts.fresh && !m.clAgentNs) return agentFor(m, token, { fresh: true });
  return { agent, ask: null };
}

/**
 * The agents on this member's own bot, for the chooser on the Coach page: the name a coach recognises, the ns that is stored.
 * No coach knows an ai_agent_ns by heart, so the list is read with the saved token and the names are shown. Empty when there is
 * no token yet or the platform refuses, and the page falls back to typing the ns. The token is opened here, never on the page.
 */
export async function agentChoicesFor(m: schema.Membership): Promise<{ ns: string; name: string }[]> {
  const token = open(m.clApiToken);
  return token ? listAgents(token) : [];
}

/** Every bot field the client's workspace holds, by name, paged the way the Stage 1 read-back pages. */
export async function listBotFields(token: string): Promise<{ name: string; value: string; varType: string; ns: string }[]> {
  const out: { name: string; value: string; varType: string; ns: string }[] = [];
  for (let page = 1; page <= 100; page++) {
    const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers: authed(token) });
    if (!back.ok) return out;
    const rows = parseBotFields(await back.json());
    out.push(...rows);
    if (!morePages(rows.length, READ_BACK_LIMIT)) break;
  }
  return out;
}

/** The field name this member's FAQ composes into: their override, else the default the Booking Agent reads. */
export const faqFieldFor = (m: schema.Membership): string => m.faqBotField?.trim() || FAQ_BOT_FIELD_DEFAULT;

export type FaqPushOutcome = { status: "sent" | "skipped" | "failed"; note: string; syncId: string | null; dropped: string[]; reads: string[]; notRead: string[] };

/**
 * Push one member's approved FAQ into the one text field, on the Bot Brief's "Approve and send to my bot". Before the
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
  const fieldRefusal = faqFieldRefusal(field, STAGE1_FIELDS, BOT_WRITTEN_FIELDS);
  if (fieldRefusal) return done("failed", fieldRefusal);

  const rows = await db.query.faqEntries.findMany({ where: and(eq(schema.faqEntries.workspaceId, m.workspaceId), eq(schema.faqEntries.userId, m.userId)) });
  const approved = rows.filter((r) => isApprovedOrigin(r.origin));
  // Nothing approved and nothing ever sent: there is nothing to do. Nothing approved but the bot still holds a previous send
  // is not the same thing — the coach removed those answers, and leaving them on the bot would have it answering from words
  // that are gone. That pushes an empty field, which is the removal.
  const lastSent = await db.query.faqSyncs.findFirst({ where: and(eq(schema.faqSyncs.membershipId, m.id), eq(schema.faqSyncs.status, "sent")), orderBy: [desc(schema.faqSyncs.createdAt)] });
  if (!approved.length && !(lastSent && lastSent.entryCount > 0)) return done("skipped", "Nothing approved yet: accept at least one answer on the Brief first.");
  const composed = composeField(rankEntries(approved));
  const snapshot = composed.included.map((e) => ({ id: e.id, question: e.question, answer: e.answer }));
  const dropped = composed.dropped.map((e) => e.question);
  const record = { chars: composed.chars, entryCount: composed.included.length, dropped, snapshot, valueReadBack: false, tokenReadBack: false };

  // Everything that must be true first: the field is allowed, the agent is chosen, the field is on the bot, and it holds
  // nothing HelixOS did not write (unless the coach waived it). Each is one sentence, the same one the Brief already showed.
  const pre = await faqPreflight(m, token, { fresh: true });
  if (pre.blocked) return done("failed", pre.blocked, {}, record);
  const agent = pre.agent;
  if (!agent) return done("failed", "Couldn't read your bot's agent from Community Loyalty. Check the token and the agent, then try again.", {}, record);
  // Push only what the agent reads: the target agent's prompt must carry the field's token, or the push is refused.
  const { reads, notRead } = agentReadsFields(agent, [field], pre.nsByName);
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
    const again = (await agentFor(m, token, { fresh: true })).agent;
    const tokenReadBack = Boolean(again && agentReadsFields(again, [field], pre.nsByName).reads.length);
    const rec = { ...record, valueReadBack, tokenReadBack };
    if (!valueReadBack) return done("failed", `Pushed, but the read-back of ${field} differs: not recorded as synced.`, { reads, notRead, dropped }, rec);
    if (!tokenReadBack) return done("failed", `Pushed and the value reads back, but the token {${field}} is no longer in the agent's prompt: not recorded as synced.`, { reads, notRead, dropped }, rec);
    if (!composed.included.length) return done("sent", "Every answer has been removed, so your bot's FAQ field is now empty. Read back and matched.", { reads, notRead, dropped }, rec);
    return done("sent", `${composed.included.length} ${composed.included.length === 1 ? "answer" : "answers"} sent (${composed.chars.toLocaleString()} of ${FAQ_FIELD_BUDGET.toLocaleString()} characters)${dropped.length ? `; ${dropped.length} dropped past the budget` : ""}, read back and matched.`, { reads, notRead, dropped }, rec);
  } catch (e) {
    return done("failed", e instanceof Error ? e.message : String(e), { reads, notRead, dropped }, record);
  }
}

/**
 * What the Bot Brief needs to know about a member's bot without ever holding the token itself: whether a token is on the
 * member, and the target agent read through it. The token is opened here and nowhere the page can reach.
 */
export type BriefAccess = {
  hasToken: boolean;
  agent: AgentInfo | null;
  /** Why the Brief cannot send yet, in the coach's words: no agent chosen, the field refused, the field not on the bot, or foreign text in it. */
  blocked: string | null;
  /** Worth saying but never a block: the field is a short type, or the coach has waived the foreign-text refusal. */
  warning: string | null;
  fieldVarType: string | null;
  /** Each bot field's variable id by name: what a prompt's chip stores, so the Brief's "Your bot reads" asks the same question the push does. */
  nsByName: Record<string, string>;
};
export async function briefAccessFor(m: schema.Membership): Promise<BriefAccess> {
  const none = { agent: null, blocked: null, warning: null, fieldVarType: null, nsByName: {} };
  const token = open(m.clApiToken);
  if (!token) return { hasToken: false, ...none };
  const check = await faqPreflight(m, token);
  return { hasToken: true, agent: check.agent, blocked: check.blocked, warning: check.warning, fieldVarType: check.fieldVarType, nsByName: check.nsByName };
}

/**
 * One log line of what the agent's prompt actually holds, as the API returned it: every string in the agent-info response with
 * its path, so the serialisation a chip takes is on the record rather than inferred from the editor. Once per member, agent and
 * outcome every ten minutes, since the Brief reads it on every render. The prompts carry the coach's own words; never the token.
 */
const promptLogged = new Map<string, number>();
function logAgentPrompt(m: schema.Membership, agent: AgentInfo, field: string, ns: string | undefined, read: boolean): void {
  const key = `${m.id}:${agent.ns}:${read}`;
  const now = Date.now();
  if ((promptLogged.get(key) ?? 0) > now - 600_000) return;
  promptLogged.set(key, now);
  console.info(`[faq.agent-reads] ${redactSecrets(JSON.stringify({ member: m.id, agent: agent.name, agentNs: agent.ns, field, fieldNs: ns ?? null, read, prompts: agent.prompts.map((p) => ({ path: p.section, text: p.text.slice(0, 4000) })) }))}`);
}

/**
 * Everything that must be true before the FAQ can be sent, read from the platform and the record: the field is one the FAQ may
 * use, the agent that answers is chosen, the field exists on the bot (the API sets a field by name; it does not create one), and
 * the field holds nothing HelixOS did not write unless the coach has waived that on the Coach page. Each blocker is one sentence
 * the coach can act on.
 */
async function faqPreflight(m: schema.Membership, token: string, opts: { fresh?: boolean } = {}): Promise<{ agent: AgentInfo | null; blocked: string | null; warning: string | null; fieldVarType: string | null; lastSentValue: string | null; nsByName: Record<string, string> }> {
  const field = faqFieldFor(m);
  const lastSync = await db.query.faqSyncs.findFirst({ where: and(eq(schema.faqSyncs.membershipId, m.id), eq(schema.faqSyncs.status, "sent")), orderBy: [desc(schema.faqSyncs.createdAt)] });
  const lastSentValue = lastSync ? composeField(lastSync.snapshot).text : null;
  const none = { nsByName: {} as Record<string, string> };
  const refused = faqFieldRefusal(field, STAGE1_FIELDS, BOT_WRITTEN_FIELDS);
  if (refused) return { agent: null, blocked: refused, warning: null, fieldVarType: null, lastSentValue, ...none };
  const { agent, ask } = await agentFor(m, token, opts);
  if (ask) return { agent: null, blocked: ask, warning: null, fieldVarType: null, lastSentValue, ...none };
  const fields = await listBotFields(token);
  const nsByName = Object.fromEntries(fields.filter((f) => f.ns).map((f) => [f.name, f.ns]));
  if (agent) logAgentPrompt(m, agent, field, nsByName[field], agentReadsFields(agent, [field], nsByName).reads.length > 0);
  const held = fields.find((f) => f.name === field);
  if (!held) return { agent, blocked: fieldMissingLine(field), warning: null, fieldVarType: null, lastSentValue, nsByName };
  // No type warning: Community Loyalty's bot fields come in one type, Text, and a type can never be changed, so a warning asking
  // for longtext asks for something that cannot be done (and nearly cost a working chip). The 20,000 budget is the real cap.
  if (holdsForeignText(held.value, lastSentValue)) {
    if (!m.faqOverwriteOk) return { agent, blocked: `${field} already holds text HelixOS did not write, and sending would erase it. Use a field of its own, or tick the override on the Coach page.`, warning: null, fieldVarType: held.varType, lastSentValue, nsByName };
    return { agent, blocked: null, warning: `${field} holds text HelixOS did not write; the override is on, so sending will replace it.`, fieldVarType: held.varType, lastSentValue, nsByName };
  }
  return { agent, blocked: null, warning: null, fieldVarType: held.varType, lastSentValue, nsByName };
}
