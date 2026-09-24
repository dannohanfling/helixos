/**
 * The Stage 1 push to a client's own Community Loyalty (uChat) workspace: HelixOS writes values into the template's existing
 * bot field names, one call per client, addressed by name (PUT /flow/set-bot-fields-by-name). One-way: the reads are the
 * preview of what the bot holds now, shown to the coach field by field before anything is sent, and the read-back of what was
 * just sent. Nothing pushes on its own: every push is the coach's press on that preview. The push is a named subset
 * (STAGE1_FIELDS), only the fields the target agent reads and that change, and it asserts it touches none of
 * BOT_WRITTEN_FIELDS before it sends, so the calendar the client chose and the appointment the agent booked stay as they were.
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
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { formatDateTime, nowIso } from "@/lib/dates";
import { BOT_WRITTEN_FIELDS, PRODUCT_FIELD, PRODUCT_FIELD_OLD, READ_BACK_LIMIT, STAGE1_FIELDS, assertStorable, botFieldsRequest, morePages, needsEyes, parseBotFields, planPayload, productSections, readBackMismatches, stage1Payload, stage1Plan, stage1Problems, stage1Warnings, type BotFieldPayload, type EyesLine, type PlanRow, type ProductSection, type Stage1Input } from "@/lib/engine/bot-fields";
import { normalizeEssence } from "@/lib/engine/essence";
import { redactSecrets } from "@/lib/engine/redact";
import { logSync } from "@/lib/integrations";

const DEFAULT_BASE = "https://www.uchat.com.au/api";
export function uchatBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.UCHAT_BASE_URL ? process.env.UCHAT_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

/**
 * One log line for every answer from Community Loyalty that is not a 2xx: the call, the status, and the platform's own words
 * (its error body, which is its message, not a secret), redacted and never the token. 22 Sep: an empty FAQ send came back 422
 * and nobody could see why, because the body was thrown away.
 */
export function logPlatformRefusal(call: string, status: number, body: string): void {
  console.error(`[cl.http] ${call} ${status} ${redactSecrets(body.slice(0, 2000))}`);
}
/** The platform's reason in a sentence a coach can read: its own message when it gave one, else the status. */
export function platformReason(status: number, body: string): string {
  let message = "";
  try {
    const j = JSON.parse(body) as { message?: unknown; errors?: Record<string, unknown> };
    message = typeof j.message === "string" ? j.message : "";
  } catch {
    message = body.trim().slice(0, 160);
  }
  return message ? `Community Loyalty said: "${redactSecrets(message)}" (${status})` : `Community Loyalty answered ${status}`;
}

export type PushOutcome = { status: "sent" | "skipped" | "failed" | "changed"; note: string; fields: string[] };

/**
 * Everything Stage 1 composes from, read off the record: the membership (its business name, zone and the coach-level bot lines),
 * the workspace, the member's offers (only those with a bot role feed the bot) and two Essence fields (the house rules and who
 * the bot speaks as).
 */
export async function stage1InputFor(membership: schema.Membership): Promise<Stage1Input> {
  const [workspace, offers, essenceRow] = await Promise.all([
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, membership.workspaceId) }),
    db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, membership.workspaceId), eq(schema.offers.userId, membership.userId)), orderBy: [schema.offers.createdAt] }),
    db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, membership.workspaceId), eq(schema.essences.userId, membership.userId)) }),
  ]);
  const essence = normalizeEssence(essenceRow?.data ?? {});
  const houseRules = essence.guidelines_to_respond?.house_rules;
  const persona = essence.identity?.bot_persona;
  return {
    businessName: membership.businessName,
    workspaceName: workspace?.name ?? "",
    // The member's own zone, else the workspace's: the same rule Today and the reminders follow.
    timezone: membership.timezone ?? workspace?.timezone ?? "UTC",
    offers,
    coach: {
      whatIDo: membership.whatIDo,
      priceMode: membership.priceMode,
      rangeLine: membership.rangeLine,
      paymentPlanLine: membership.paymentPlanLine,
      priceAnswer: membership.priceAnswer,
      guaranteeLine: membership.guaranteeLine,
      guaranteeCoverageLine: membership.guaranteeCoverageLine,
      houseRules: Array.isArray(houseRules) ? (houseRules as string[]) : [],
      persona: typeof persona === "string" ? persona : "",
      questions: [membership.botQuestion1, membership.botQuestion2, membership.botQuestion3],
    },
  };
}

/** The Stage 1 payload for one member, with the input it was composed from. */
export async function payloadFor(membership: schema.Membership): Promise<{ payload: BotFieldPayload; input: Stage1Input }> {
  const input = await stage1InputFor(membership);
  return { payload: stage1Payload(input), input };
}

/** An approval is of exact text: the line's hash. */
export const textHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);
/** Each Needs-your-eyes line for this member, and whether its exact text is approved. */
export async function eyesFor(membershipId: string, input: Stage1Input): Promise<{ line: EyesLine; approved: boolean }[]> {
  const rows = await db.query.botApprovals.findMany({ where: eq(schema.botApprovals.membershipId, membershipId) });
  const ok = new Set(rows.map((r) => `${r.elementKey}:${r.textHash}`));
  return needsEyes(input).map((line) => ({ line, approved: ok.has(`${line.key}:${textHash(line.text)}`) }));
}

/**
 * What a Stage 1 push would change on one member's bot, read live: the bot's fields, every agent's prompt, and the plan per field
 * (stage1Plan). Bot fields belong to the whole bot, so every agent on it is read, not the one chosen for the FAQ (23 Sep: Danno's
 * FAQ agent reads only the FAQ field; his business facts are read by another agent). The list is the one cached a minute per bot;
 * a list that names an agent the bot no longer answers for is read again once. `key` fingerprints exactly what would be sent
 * against what the bot holds now; the push carries the key the coach saw and refuses when it no longer matches, so what is sent
 * is what was shown.
 *
 * `blocked` means the bot could not be read at all. `holds` are what stop the push while the page still shows everything: a gap
 * in the record (stage1Problems) or a Needs-your-eyes line not yet approved in its exact text. `warnings` never stop it.
 */
export type Stage1Preview = {
  blocked: string | null;
  rows: PlanRow[];
  key: string;
  agentNames: string[];
  input: Stage1Input;
  sections: ProductSection[];
  holds: string[];
  warnings: string[];
  eyes: { line: EyesLine; approved: boolean }[];
};
export async function stage1Preview(m: schema.Membership): Promise<Stage1Preview> {
  const { payload, input } = await payloadFor(m);
  const eyes = await eyesFor(m.id, input);
  const unapproved = eyes.filter((e) => !e.approved).map((e) => `Not approved yet: ${e.line.label}.`);
  const none = { rows: [], key: "", agentNames: [], input, sections: productSections(input), holds: [...stage1Problems(input, payload), ...unapproved], warnings: stage1Warnings(input), eyes };
  const token = open(m.clApiToken);
  if (!token) return { blocked: "No Community Loyalty API token on this member yet: add it on the Coach page first.", ...none };
  // The drip webhook is never opened here: its shape (/api/iwh/) is refused by assertStorable without the value in hand.
  assertStorable(payload, [token]);
  const t0 = Date.now();
  const agents = await allAgents(token);
  const agentsMs = Date.now() - t0;
  if ("blocked" in agents) return { ...none, blocked: agents.blocked };
  const agentNames = agents.infos.map((a) => a.name);
  const held = await readBotFields(token);
  logStage1Read(m.id, { agents: agentNames.length, fields: "rows" in held ? held.rows.length : null, agentsMs, fieldsMs: Date.now() - t0 - agentsMs, readMs: Date.now() - t0 });
  if ("refused" in held) return { ...none, agentNames, blocked: `Couldn't read the bot's fields from Community Loyalty. ${held.refused}` };
  const rows = stage1Plan(payload, held.rows, agents.infos, m.clBotFields);
  for (const r of rows) if (r.name && (BOT_WRITTEN_FIELDS as readonly string[]).includes(r.name)) throw new Error(`bot-fields: ${r.name} is written by the bot and cannot be pushed`);
  const key = createHash("sha256").update(JSON.stringify(rows.filter((r) => r.status === "change").map((r) => [r.name, r.current, r.next]))).digest("hex").slice(0, 32);
  // Pushed but ignored: the rules would reach the bot and change nothing it says (true on Danno's bot and the master, 23 Sep).
  const rules = rows.find((r) => r.field === "ai_constraints_cbf");
  const warnings = [...none.warnings, ...(rules?.status === "unread" ? ["No agent on your bot reads your house rules yet, so they would be pushed and ignored. Add the house rules to your Booking Agent's prompt in Community Loyalty."] : [])];
  return { ...none, blocked: null, rows, key, agentNames, warnings };
}

/**
 * One log line per Stage 1 read of a bot: how many agents and fields, and how long each half took (24 Sep: the preview sat on
 * "Loading…" for over a minute on Danno's bot, five agents). Counts and times only, never a value or the token. The agents'
 * prompts are read in parallel; the field pages one after another, because the list gives no total to fan out over.
 */
function logStage1Read(member: string, t: { agents: number; fields: number | null; agentsMs: number; fieldsMs: number; readMs: number }): void {
  console.info(`[stage1.read] ${redactSecrets(JSON.stringify({ member, ...t }))}`);
}

/** Every agent on the bot with its prompts: the cached list, read again once if it names an agent the bot no longer answers for. */
async function allAgents(token: string, fresh = false): Promise<{ infos: AgentInfo[] } | { blocked: string }> {
  const list = await listAgents(token, { fresh });
  if (!list.length) return fresh ? { blocked: "No agent on this bot yet, so nothing it holds is read. Add one in Community Loyalty first." } : allAgents(token, true);
  const infos = await Promise.all(list.map((a) => readAgentInfo(token, a.ns)));
  if (infos.every(Boolean)) return { infos: infos as AgentInfo[] };
  if (!fresh) return allAgents(token, true);
  return { blocked: `Couldn't read ${list.filter((_, i) => !infos[i]).map((a) => a.name).join(", ")} from Community Loyalty. Check the token, then try again.` };
}

/**
 * HelixOS's own record behind a Stage 1 push, as one fingerprint: the payload composed from the membership, the workspace and the
 * offers. Stored at each push, so the Coach page can say "changed since the last push" from HelixOS's data alone, with no read of
 * the bot per row.
 */
export const stage1SourceKey = (payload: BotFieldPayload): string => createHash("sha256").update(JSON.stringify(STAGE1_FIELDS.map((f) => [f, payload[f]]))).digest("hex").slice(0, 32);
/** "Last pushed …, by …" for the page, naming whoever pressed it: you, the member themself, or their coach. */
export async function lastPushedLine(m: schema.Membership, viewerId: string, tz: string): Promise<string> {
  if (!m.clBotFieldsPushedAt) return "Not pushed yet.";
  const by = m.clBotFieldsPushedBy ? await db.query.users.findFirst({ where: eq(schema.users.id, m.clBotFieldsPushedBy) }) : null;
  const who = !by ? "" : by.id === viewerId ? " by you" : ` by ${by.name}`;
  return `Last pushed ${formatDateTime(m.clBotFieldsPushedAt, tz)}${who}.`;
}

/** Whether HelixOS's record for any Stage 1 field has changed since the last push; null before any push. */
export async function changedSinceLastPush(m: schema.Membership): Promise<boolean | null> {
  if (!m.clBotFieldsPushedAt || !m.clBotSourceKey) return null;
  return stage1SourceKey((await payloadFor(m)).payload) !== m.clBotSourceKey;
}

/** One push per member at a time: a second press that reaches the server while the first is still out is dropped, not sent. */
const pushing = new Set<string>();

/**
 * Push one member's Stage 1 fields, as the coach saw them on the preview: only the fields that change, by the name the bot has,
 * read back over only those. Nothing is sent when the plan no longer matches the key the coach pressed on (the bot or the record
 * moved since the page was read), when nothing would change, or while a push for this member is already out; none of those is
 * a push, so none is logged. Never throws.
 */
export async function pushBotFields(membershipId: string, opts: { key: string; reason: string; by: string }): Promise<PushOutcome> {
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  if (!m) return { status: "skipped", note: "No such member.", fields: [] };
  if (pushing.has(m.id)) return { status: "skipped", note: "A push to this bot is already on its way.", fields: [] };
  pushing.add(m.id);
  try {
    return await pushPlanned(m, opts);
  } finally {
    pushing.delete(m.id);
  }
}
async function pushPlanned(m: schema.Membership, opts: { key: string; reason: string; by: string }): Promise<PushOutcome> {
  const log = async (status: "sent" | "failed", note: string, fields: string[]) => {
    // The sync log carries the names and the reason, never a value: values are on the membership row, the token nowhere.
    await logSync({ workspaceId: m.workspaceId, userId: m.userId, provider: "community_loyalty", direction: "out", event: "botfields.push", payload: { reason: opts.reason, fields, by: opts.by }, status, note: redactSecrets(note) });
    return { status, note, fields };
  };
  const token = open(m.clApiToken);
  if (!token) return { status: "skipped", note: "No Community Loyalty API token on this member yet.", fields: [] };
  let preview: Stage1Preview;
  try {
    preview = await stage1Preview(m);
  } catch (e) {
    return log("failed", e instanceof Error ? e.message : String(e), []);
  }
  if (preview.blocked) return log("failed", preview.blocked, []);
  // A gap in the record or a line not yet approved stops the push before anything is sent; it is not a push, so not logged.
  if (preview.holds.length) return { status: "skipped", note: `Not sent. ${preview.holds.join(" ")}`, fields: [] };
  if (preview.key !== opts.key) return { status: "changed", note: "The bot or the record changed since this page was read. Here is the new before-and-after; nothing was sent.", fields: [] };
  const payload = planPayload(preview.rows);
  const names = Object.keys(payload);
  if (!names.length) return { status: "skipped", note: "Nothing to change: the bot already holds everything HelixOS would send.", fields: [] };
  for (const n of names) if ((BOT_WRITTEN_FIELDS as readonly string[]).includes(n) || !preview.rows.some((r) => r.name === n)) return log("failed", `Refused: ${n} is not a Stage 1 field.`, names);
  try {
    const res = await withTimeout(`${uchatBase()}/flow/set-bot-fields-by-name`, { method: "PUT", headers: authed(token), body: JSON.stringify(botFieldsRequest(payload)) });
    const body = await res.text();
    if (!res.ok) {
      logPlatformRefusal("PUT /flow/set-bot-fields-by-name (stage 1)", res.status, body);
      return log("failed", `Not sent: ${platformReason(res.status, body)}.`, names);
    }
    // Read back: a 200 says the call was accepted, not that the fields were written. Only the fields sent are compared, and
    // the record moves only on a match.
    const back = await readBotFields(token);
    if ("refused" in back) return log("failed", `Pushed, but the read-back failed: ${back.refused} Not recorded as synced.`, names);
    const held: Record<string, string | undefined> = Object.fromEntries(back.rows.map((r) => [r.name, r.value]));
    const mismatched = readBackMismatches(payload, held);
    if (mismatched.length) return log("failed", `Pushed, but the read-back differs on ${mismatched.join(", ")}: not recorded as synced.`, names);
    // What the bot now holds from HelixOS: the fields just sent and the ones it already held unchanged, over what earlier pushes
    // confirmed, so a field left out this time keeps its last sent value on the record (the nothing-current rule compares to it).
    const holds = { ...m.clBotFields, ...Object.fromEntries(preview.rows.filter((r) => (r.status === "change" || r.status === "same") && r.name).map((r) => [r.name as string, r.next])) };
    await db.update(schema.memberships).set({ clBotFields: holds, clBotFieldsPushedAt: nowIso(), clBotFieldsPushedBy: opts.by, clBotSourceKey: stage1SourceKey((await payloadFor(m)).payload) }).where(eq(schema.memberships.id, m.id));
    return log("sent", `${names.length} ${names.length === 1 ? "field" : "fields"} changed on the bot and read back`, names);
  } catch (e) {
    return log("failed", e instanceof Error ? e.message : String(e), names);
  }
}

/**
 * The bot's fields, every page, or the platform's reason it refused. The Stage 1 preview needs to know a failed read from an
 * empty bot, so this one does not swallow the refusal.
 */
async function readBotFields(token: string): Promise<{ rows: { name: string; value: string; varType: string; ns: string }[] } | { refused: string }> {
  const rows: { name: string; value: string; varType: string; ns: string }[] = [];
  try {
    for (let page = 1; page <= 100; page++) {
      const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers: authed(token) });
      if (!back.ok) {
        const body = await back.text();
        logPlatformRefusal("GET /flow/bot-fields (stage 1)", back.status, body);
        return { refused: `${platformReason(back.status, body)} on page ${page}.` };
      }
      const pageRows = parseBotFields(await back.json());
      rows.push(...pageRows);
      if (!morePages(pageRows.length, READ_BACK_LIMIT)) break;
    }
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) };
  }
  return { rows };
}

/**
 * Which name this member's bot carries the offers under, for the Coach page to name the fallback: the current name, the older
 * one, or neither. Read with the bot's own token and cached a minute per bot, the same as the agent list, since the Coach page
 * reads it on every render. Null with no token or when the platform will not list the fields.
 */
const fieldNameLists = new Map<string, { at: number; names: string[] }>();
export async function productFieldFor(m: schema.Membership): Promise<{ name: string | null; fallback: boolean } | null> {
  const token = open(m.clApiToken);
  if (!token) return null;
  const key = botKey(token);
  const hit = fieldNameLists.get(key);
  let names = hit && hit.at > Date.now() - AGENT_LIST_TTL_MS ? hit.names : undefined;
  if (!names) {
    const back = await readBotFields(token);
    if ("refused" in back) return null;
    names = back.rows.map((r) => r.name);
    fieldNameLists.set(key, { at: Date.now(), names });
  }
  if (names.includes(PRODUCT_FIELD)) return { name: PRODUCT_FIELD, fallback: false };
  if (names.includes(PRODUCT_FIELD_OLD)) return { name: PRODUCT_FIELD_OLD, fallback: true };
  return { name: null, fallback: false };
}

/* ───────────── The coach's brain: the approved FAQ composed into one text field, pushed only where the agent reads it ───────────── */

import { FAQ_BOT_FIELD_DEFAULT, FAQ_FIELD_BUDGET, agentReadsFields, FAQ_EMPTY_SENT, faqFieldValue, chooseAgentLine, composeField, faqFieldRefusal, fieldMissingLine, holdsForeignText, notReadWarning, parseAgentInfo, parseAgents, pickAgent, rankEntries, type AgentInfo } from "@/lib/engine/faq";
import { newId } from "@/lib/ids";

const APPROVED = ["ai_accepted", "edited", "coach"] as const;
/** An entry the Bot Brief has approved: accepted, edited (an edit is a review) or the coach's own words. Never ai_unreviewed. */
export const isApprovedOrigin = (origin: string | null | undefined): boolean => (APPROVED as readonly string[]).includes(origin ?? "");

/**
 * Calls HelixOS never makes. `delete-bot-field` and `delete-bot-field-by-name` remove the field itself, not its value: on
 * ai_faq_cbf that would destroy the field and break the chip in the agent's prompt, which points at the field's id. HelixOS
 * writes values and never deletes anything on a bot, so a DELETE of any kind is refused too. Every request to Community
 * Loyalty goes through withTimeout, the one fetch in this client, and that checks here before anything leaves.
 */
export const NEVER_CALLED = ["/flow/delete-bot-field", "/flow/delete-bot-field-by-name"] as const;
export function assertCallable(url: string, method: string = "GET"): void {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  const hit = NEVER_CALLED.find((p) => path.endsWith(p));
  if (hit) throw new Error(`community-loyalty: ${hit} removes the field itself and is never called`);
  if (method.toUpperCase() === "DELETE") throw new Error(`community-loyalty: HelixOS never deletes on a bot (${path})`);
}

export async function withTimeout(input: string, init: RequestInit): Promise<Response> {
  assertCallable(input, init.method);
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
      logPlatformRefusal("GET /flow/ai-agents", res.status, await res.text());
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
    if (!res.ok) {
      logPlatformRefusal("POST /flow/ai-agent-info", res.status, await res.text());
      return null;
    }
    return parseAgentInfo(await res.json());
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
    if (!back.ok) {
      logPlatformRefusal("GET /flow/bot-fields", back.status, await back.text());
      return out;
    }
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
  // One send per member at a time, as the Stage 1 push: a second press that reaches the server while the first is out is dropped.
  if (sendingFaq.has(membershipId)) return { status: "skipped", note: FAQ_SEND_IN_FLIGHT, syncId: null, dropped: [], reads: [], notRead: [] };
  sendingFaq.add(membershipId);
  try {
    return await sendFaq(membershipId, opts);
  } finally {
    sendingFaq.delete(membershipId);
  }
}
const sendingFaq = new Set<string>();
export const FAQ_SEND_IN_FLIGHT = "A send to this bot is already on its way.";
async function sendFaq(membershipId: string, opts: { reason: string; sentBy: string }): Promise<FaqPushOutcome> {
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
  const lastSent = await db.query.faqSyncs.findFirst({ where: and(eq(schema.faqSyncs.membershipId, m.id), eq(schema.faqSyncs.status, "sent")), orderBy: [desc(schema.faqSyncs.createdAt), desc(sql`rowid`)] });
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
    // One write: the answers, or, with none approved, the sentence that says so (FAQ_EMPTY_VALUE; the platform refuses empty).
    const sent = faqFieldValue(composed.text);
    const res = await withTimeout(`${uchatBase()}/flow/set-bot-fields-by-name`, { method: "PUT", headers: authed(token), body: JSON.stringify({ data: [{ name: field, value: sent }] }) });
    const body = await res.text();
    if (!res.ok) {
      logPlatformRefusal(`PUT /flow/set-bot-fields-by-name (faq, ${composed.text ? "answers" : "no approved answers"})`, res.status, body);
      return done("failed", `Not sent: ${platformReason(res.status, body)}.`, { reads, notRead, dropped }, record);
    }
    // Read back, both halves: the value the bot holds, and the token still in the agent's prompt.
    let held: string | undefined;
    for (let page = 1; page <= 100; page++) {
      const back = await withTimeout(`${uchatBase()}/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}`, { method: "GET", headers: authed(token) });
      if (!back.ok) {
        logPlatformRefusal("GET /flow/bot-fields (faq read-back)", back.status, await back.text());
        return done("failed", `Pushed, but the read-back answered ${back.status} on page ${page}: not recorded as synced.`, { reads, notRead, dropped }, record);
      }
      const pageRows = parseBotFields(await back.json());
      const hit = pageRows.find((r) => r.name === field);
      if (hit) held = hit.value;
      if (!morePages(pageRows.length, READ_BACK_LIMIT)) break;
    }
    // One read-back: the field holds exactly what was written.
    const valueReadBack = held === sent;
    const again = (await agentFor(m, token, { fresh: true })).agent;
    const tokenReadBack = Boolean(again && agentReadsFields(again, [field], pre.nsByName).reads.length);
    const rec = { ...record, valueReadBack, tokenReadBack };
    if (!valueReadBack) return done("failed", `Pushed, but the read-back of ${field} differs: not recorded as synced.`, { reads, notRead, dropped }, rec);
    if (!tokenReadBack) return done("failed", `Pushed and the value reads back, but the token {${field}} is no longer in the agent's prompt: not recorded as synced.`, { reads, notRead, dropped }, rec);
    if (!composed.included.length) return done("sent", `${FAQ_EMPTY_SENT} Read back and matched.`, { reads, notRead, dropped }, rec);
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
  /** What the FAQ field holds on the bot now, read live; null when there is no token or no such field. The Brief says this, not the last sync record. */
  heldValue: string | null;
};
export async function briefAccessFor(m: schema.Membership): Promise<BriefAccess> {
  const none = { agent: null, blocked: null, warning: null, fieldVarType: null, nsByName: {}, heldValue: null };
  const token = open(m.clApiToken);
  if (!token) return { hasToken: false, ...none };
  const check = await faqPreflight(m, token);
  return { hasToken: true, agent: check.agent, blocked: check.blocked, warning: check.warning, fieldVarType: check.fieldVarType, nsByName: check.nsByName, heldValue: check.heldValue ?? null };
}

/**
 * One log line of what the agent's prompt actually holds, as the API returned it: every string in the agent-info response with
 * its path, so the serialisation a chip takes is on the record rather than inferred from the editor. Once per member, agent and
 * outcome every ten minutes, since the Brief reads it on every render. The prompts carry the coach's own words; never the token.
 */
const promptLogged = new Map<string, number>();
function logAgentPrompt(m: schema.Membership, agent: AgentInfo, field: string, ns: string | undefined, read: boolean, ms: number): void {
  const key = `${m.id}:${agent.ns}:${read}`;
  const now = Date.now();
  if ((promptLogged.get(key) ?? 0) > now - 600_000) return;
  promptLogged.set(key, now);
  console.info(`[faq.agent-reads] ${redactSecrets(JSON.stringify({ member: m.id, agent: agent.name, agentNs: agent.ns, field, fieldNs: ns ?? null, read, readMs: ms, prompts: agent.prompts.map((p) => ({ path: p.section, text: p.text.slice(0, 4000) })) }))}`);
}

/**
 * Everything that must be true before the FAQ can be sent, read from the platform and the record: the field is one the FAQ may
 * use, the agent that answers is chosen, the field exists on the bot (the API sets a field by name; it does not create one), and
 * the field holds nothing HelixOS did not write unless the coach has waived that on the Coach page. Each blocker is one sentence
 * the coach can act on.
 */
async function faqPreflight(m: schema.Membership, token: string, opts: { fresh?: boolean } = {}): Promise<{ agent: AgentInfo | null; blocked: string | null; warning: string | null; fieldVarType: string | null; lastSentValue: string | null; nsByName: Record<string, string>; heldValue?: string | null }> {
  const started = Date.now();
  const field = faqFieldFor(m);
  const lastSync = await db.query.faqSyncs.findFirst({ where: and(eq(schema.faqSyncs.membershipId, m.id), eq(schema.faqSyncs.status, "sent")), orderBy: [desc(schema.faqSyncs.createdAt), desc(sql`rowid`)] });
  const lastSentValue = lastSync ? composeField(lastSync.snapshot).text : null;
  const none = { nsByName: {} as Record<string, string> };
  const refused = faqFieldRefusal(field, STAGE1_FIELDS, BOT_WRITTEN_FIELDS);
  if (refused) return { agent: null, blocked: refused, warning: null, fieldVarType: null, lastSentValue, ...none };
  const { agent, ask } = await agentFor(m, token, opts);
  if (ask) return { agent: null, blocked: ask, warning: null, fieldVarType: null, lastSentValue, ...none };
  const fields = await listBotFields(token);
  const nsByName = Object.fromEntries(fields.filter((f) => f.ns).map((f) => [f.name, f.ns]));
  if (agent) logAgentPrompt(m, agent, field, nsByName[field], agentReadsFields(agent, [field], nsByName).reads.length > 0, Date.now() - started);
  const held = fields.find((f) => f.name === field);
  const heldValue = held ? held.value : null;
  if (!held) return { agent, blocked: fieldMissingLine(field), warning: null, fieldVarType: null, lastSentValue, nsByName };
  // No type warning: Community Loyalty's bot fields come in one type, Text, and a type can never be changed, so a warning asking
  // for longtext asks for something that cannot be done (and nearly cost a working chip). The 20,000 budget is the real cap.
  if (holdsForeignText(held.value, lastSentValue)) {
    if (!m.faqOverwriteOk) return { agent, blocked: `${field} already holds text HelixOS did not write, and sending would erase it. Use a field of its own, or tick the override on the Coach page.`, warning: null, fieldVarType: held.varType, lastSentValue, nsByName, heldValue };
    return { agent, blocked: null, warning: `${field} holds text HelixOS did not write; the override is on, so sending will replace it.`, fieldVarType: held.varType, lastSentValue, nsByName, heldValue };
  }
  return { agent, blocked: null, warning: null, fieldVarType: held.varType, lastSentValue, nsByName, heldValue };
}
