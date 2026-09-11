/**
 * Bring-your-own AI. Every call runs on the signed-in member's own key (Anthropic or OpenAI), is logged with its token counts
 * and estimated cost, and is refused past the workspace's daily cap. No key → null, and every feature falls back to its
 * rule-based draft exactly as before. There is no coach or house key.
 *
 * draft() is the only way a model is called in this codebase (ESLint keeps the SDKs out of every other file). It builds the
 * system message itself: the client's Essence first, the feature's task instruction second. No feature composes its own,
 * so a voice can never be pasted inline and drift.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer, type Viewer } from "@/lib/auth";
import { open } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { todayInTz } from "@/lib/dates";
import { FEATURES, MODELS, estimateCost, explainAiError, modelFor, type AiProvider } from "@/lib/engine/ai-usage";
import { assembleSystem, type SystemBlock } from "@/lib/engine/essence";
import { essenceBlockFor } from "@/lib/queries/essence";

export type AiStatus = { hasKey: boolean; provider: AiProvider | null; last4: string; lastError: string | null; callsToday: number; cap: number; exempt: boolean; blocked: boolean };

/** Development and smoke tests point the SDKs at a mock. Never honoured in production. */
function baseURL(): string | undefined {
  return process.env.NODE_ENV !== "production" && process.env.AI_BASE_URL ? process.env.AI_BASE_URL : undefined;
}
/** The OpenAI SDK's base already includes /v1 (its paths are /responses), Anthropic's does not (its paths are /v1/messages). */
function openaiBaseURL(): string | undefined {
  const b = baseURL();
  return b ? `${b.replace(/\/$/, "")}/v1` : undefined;
}

export async function credentialFor(workspaceId: string, userId: string) {
  return db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, workspaceId), eq(schema.aiCredentials.userId, userId)) });
}

/** Rows are stamped in UTC by the database; "today" is the workspace day. Close enough for a soft cap. */
async function callsToday(v: Viewer): Promise<number> {
  const rows = await db.select({ id: schema.aiUsage.id }).from(schema.aiUsage).where(and(eq(schema.aiUsage.workspaceId, v.workspace.id), eq(schema.aiUsage.userId, v.user.id), gte(schema.aiUsage.createdAt, todayInTz(v.tz))));
  return rows.length;
}

/** What the pages need to decide whether to show a ✨ button and what to say next to it. */
export async function aiStatus(v: Viewer): Promise<AiStatus> {
  const [cred, today] = await Promise.all([credentialFor(v.workspace.id, v.user.id), callsToday(v)]);
  const cap = v.workspace.aiDailyCap;
  const exempt = v.membership.aiCapExempt;
  return { hasKey: Boolean(cred && !cred.lastError), provider: cred?.provider ?? null, last4: cred?.last4 ?? "", lastError: cred?.lastError ?? null, callsToday: today, cap, exempt, blocked: !exempt && today >= cap };
}

/** True when the signed-in member has a working key and is under their daily cap. */
export async function hasAiKey(): Promise<boolean> {
  const v = await getViewer();
  if (!v) return false;
  const s = await aiStatus(v);
  return s.hasKey && !s.blocked;
}

type Result = { text: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };

/** The Essence block carries a cache marker: it is the same prefix on every call, which is what prompt caching is for. */
async function callAnthropic(key: string, model: string, system: SystemBlock[], user: string, maxTokens: number): Promise<Result | null> {
  const client = new Anthropic({ apiKey: key, baseURL: baseURL() });
  const blocks: Anthropic.TextBlockParam[] = system.map((b) => (b.cached ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } } : { type: "text", text: b.text }));
  const stream = client.messages.stream({ model, max_tokens: maxTokens, system: blocks, messages: [{ role: "user", content: user }] });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") return null;
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0, cacheReadTokens: message.usage.cache_read_input_tokens ?? 0 };
}

/** OpenAI caches a repeated prefix on its own (no marker); the voice leads the instructions so that prefix is the Essence. */
async function callOpenAI(key: string, model: string, system: SystemBlock[], user: string, maxTokens: number): Promise<Result | null> {
  const client = new OpenAI({ apiKey: key, baseURL: openaiBaseURL() });
  const res = await client.responses.create({ model, instructions: system.map((b) => b.text).join("\n\n"), input: user, max_output_tokens: maxTokens });
  const text = (res.output_text ?? "").trim();
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  return { text, inputTokens: Math.max(0, (res.usage?.input_tokens ?? 0) - cached), outputTokens: res.usage?.output_tokens ?? 0, cacheWriteTokens: 0, cacheReadTokens: cached };
}

export type DraftOptions = { feature?: keyof typeof FEATURES | string };

/**
 * Drafts with the member's own key. `task` is the feature's instruction only: the system message is assembled here as the
 * client's Essence (their voice, as JSON, cached) followed by that task. With no Essence the task runs alone and no voice is
 * invented. Returns null when there is no key, the key is broken, the cap is reached, or the provider refused, so every
 * caller keeps its rule-based path. Logs usage, cache tokens included, on every completed call.
 */
export async function draft(task: string, user: string, maxTokens = 4000, opts: DraftOptions = {}): Promise<string | null> {
  const v = await getViewer();
  if (!v) return null;
  const cred = await credentialFor(v.workspace.id, v.user.id);
  if (!cred || cred.lastError) return null;
  if (!v.membership.aiCapExempt && (await callsToday(v)) >= v.workspace.aiDailyCap) return null;
  const key = open(cred.keyEncrypted);
  if (!key) return null;
  const feature = opts.feature ?? "composer_polish";
  const model = modelFor(cred.provider, feature);
  const system = assembleSystem(await essenceBlockFor(v.workspace.id, v.user.id), task).blocks;
  let r: Result | null = null;
  try {
    r = cred.provider === "anthropic" ? await callAnthropic(key, model, system, user, maxTokens) : await callOpenAI(key, model, system, user, maxTokens);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    // A key that stops working is marked so the pages stop offering ✨ and the member sees why on Settings.
    const modelAccess = /does not exist or you do not have access|model_not_found|model.*not found/i.test(err.message ?? "") || (err.status === 404 && /model/i.test(err.message ?? ""));
    if (err.status === 401 || err.status === 402 || err.status === 403 || modelAccess) {
      console.error("[ai] draft failed", JSON.stringify({ provider: cred.provider, model, status: err.status, message: (err.message ?? "").slice(0, 500) }));
      await db.update(schema.aiCredentials).set({ lastError: explainAiError(cred.provider, err.status, err.message ?? "", model) }).where(eq(schema.aiCredentials.id, cred.id));
    }
    return null;
  }
  if (!r) return null;
  await db.insert(schema.aiUsage).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, provider: cred.provider, model, feature, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheWriteTokens: r.cacheWriteTokens, cacheReadTokens: r.cacheReadTokens, estimatedCostUsd: estimateCost(model, r.inputTokens, r.outputTokens, r.cacheWriteTokens, r.cacheReadTokens) ?? 0 });
  return r.text || null;
}

/** A cheap real call that proves the key works and billing is on. Returns the reason in plain words when it doesn't. */
export async function validateKey(provider: AiProvider, key: string): Promise<{ ok: true; inputTokens: number; outputTokens: number; model: string } | { ok: false; reason: string }> {
  const model = MODELS[provider].light;
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey: key, baseURL: baseURL(), maxRetries: 0 });
      const m = await client.messages.create({ model, max_tokens: 8, messages: [{ role: "user", content: "Reply with the single word: ok" }] });
      return { ok: true, inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens, model };
    }
    const client = new OpenAI({ apiKey: key, baseURL: openaiBaseURL(), maxRetries: 0 });
    const r = await client.responses.create({ model, input: "Reply with the single word: ok", max_output_tokens: 16 });
    return { ok: true, inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0, model };
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error("[ai] key check failed", JSON.stringify({ provider, model, status: err.status, message: (err.message ?? String(e)).slice(0, 500) }));
    return { ok: false, reason: explainAiError(provider, err.status, err.message ?? String(e), model) };
  }
}


