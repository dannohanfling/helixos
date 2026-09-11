/**
 * Bring-your-own AI: which model does which job, what it costs, and how to explain a failed key.
 * Pure. Prices are list prices per million tokens and are estimates for the client's own dashboard, never a bill.
 */
import type { AiUsage } from "@/db/schema";

export type AiProvider = "anthropic" | "openai";
export type Tier = "strong" | "light";

/** Job size decides the model. Long-form drafting earns a strong model; polishing one post does not. */
export const FEATURES: Record<string, { label: string; tier: Tier }> = {
  webinar_section: { label: "Webinar script sections", tier: "strong" },
  ladder: { label: "Comment ladders", tier: "strong" },
  composer_polish: { label: "Composer: shape for every channel", tier: "light" },
  repurpose: { label: "Repurpose drafts", tier: "light" },
  group_variant: { label: "Group-aligned drafts", tier: "light" },
  principle_content: { label: "Doctrine content", tier: "light" },
  harvest: { label: "Testimonials from a recording", tier: "strong" },
  evidence_terms: { label: "Evidence: a claim into search terms", tier: "light" },
  lead_magnet: { label: "Lead magnet drafts", tier: "strong" },
  key_check: { label: "Key check", tier: "light" },
};

export const MODELS: Record<AiProvider, Record<Tier, string>> = {
  anthropic: { strong: "claude-opus-5", light: "claude-sonnet-5" },
  openai: { strong: "gpt-6-astra", light: "gpt-5.6-sol" },
};

/**
 * USD per million tokens [input, output], from each provider's price list (Anthropic: docs pricing table; OpenAI:
 * developers.openai.com/api/docs/pricing). The OpenAI tiers are chosen to price-match the Anthropic tiers, so a client's estimate
 * is the same number whichever provider they connect. Update here only.
 */
export const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "gpt-6-astra": [5, 25],
  "gpt-5.6-sol": [2, 10],
  "gpt-5.6-terra": [1, 6],
  "gpt-5.6-luna": [0.1, 0.6],
  // Legacy: nothing routes here any more; kept only so usage rows written before the tier change still cost out.
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
};

export function modelFor(provider: AiProvider, feature: string): string {
  return MODELS[provider][FEATURES[feature]?.tier ?? "light"];
}

/** Prompt-cache multipliers on the input price: a write costs 1.25× (5-minute entry), a read 0.1×. Applied to both providers' cached tokens. */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Null for a model with no listed price: an unknown cost must show as unknown, never as a confident wrong number.
 * `inputTokens` is the uncached remainder; the Essence block arrives as cache writes or cache reads and is priced here too,
 * so the estimate carries the voice prefix on every call.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number, cacheWriteTokens = 0, cacheReadTokens = 0): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const [pin, pout] = price;
  return (inputTokens * pin + outputTokens * pout + cacheWriteTokens * pin * CACHE_WRITE_MULTIPLIER + cacheReadTokens * pin * CACHE_READ_MULTIPLIER) / 1_000_000;
}

/** What a voice prefix of this many tokens adds to one call, uncached, written to cache, and read from cache. */
export function essenceCallDelta(model: string, essenceTokens: number): { uncached: number; cacheWrite: number; cacheRead: number } | null {
  const price = PRICES[model];
  if (!price) return null;
  const pin = price[0] / 1_000_000;
  return { uncached: essenceTokens * pin, cacheWrite: essenceTokens * pin * CACHE_WRITE_MULTIPLIER, cacheRead: essenceTokens * pin * CACHE_READ_MULTIPLIER };
}
export const priceKnown = (model: string) => Boolean(PRICES[model]);

/** A key's shape says which console it came from. Catches the most common mistake before a network call. */
export function providerOfKey(key: string): AiProvider | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{4,}$/.test(k)) return "openai";
  return null;
}

/** Turns an SDK error into the sentence a business owner needs. */
export function explainAiError(provider: AiProvider, status: number | undefined, message: string, model?: string): string {
  const m = message.toLowerCase();
  const name = provider === "anthropic" ? "Anthropic" : "OpenAI";
  const console_ = provider === "anthropic" ? "console.anthropic.com" : "platform.openai.com";
  if (/does not exist or you do not have access|model_not_found|not_found_error.*model|model.*not found|model.*does not exist/.test(m) || (status === 404 && /model/.test(m)))
    return `Your ${name} account does not have access to the model ${model ?? "HelixOS uses"}${model ? "" : ""}. The key itself works. Check the account's model access or tier at ${console_}, then check again.`;
  if (status === 401 || /invalid api key|authentication|incorrect api key/.test(m)) return `${provider === "anthropic" ? "Anthropic" : "OpenAI"} rejected the key (401). Paste it again from ${console_}, all of it, with no spaces.`;
  if (/credit balance|insufficient_quota|billing|exceeded your current quota|purchase credits/.test(m) || status === 402) return `The key works but the account has no billing set up. Add a payment method or credits at ${console_}, then check again.`;
  if (status === 403 || /permission/.test(m)) return `The key doesn't have permission to use the model (403). Create a new key at ${console_} without restrictions.`;
  if (status === 429) return "The provider is rate-limiting this key right now. The key itself is fine; try again in a minute.";
  if (status === 404) return `The provider returned 404 for this request. Check the account at ${console_} has access to current models.`;
  if (/fetch failed|econn|network|timeout/.test(m)) return "Couldn't reach the provider. Check the connection and try again.";
  // The fallthrough keeps the case and drops the vendor's words; src/lib/ai.ts logs them under [ai].
  return `The provider returned an error${status ? ` (${status})` : ""}. Try again in a minute, and if it keeps happening check the key at ${console_}.`;
}

export type UsageRollup = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Null when any call used a model with no listed price: a partial total would read as a confident wrong number. */
  costUsd: number | null;
  unknownModels: string[];
  byFeature: { feature: string; label: string; calls: number; costUsd: number | null }[];
};

export function rollup(rows: (Pick<AiUsage, "feature" | "model" | "inputTokens" | "outputTokens" | "estimatedCostUsd"> & Partial<Pick<AiUsage, "cacheWriteTokens" | "cacheReadTokens">>)[]): UsageRollup {
  const by = new Map<string, { calls: number; costUsd: number | null }>();
  const unknown = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let costUsd: number | null = 0;
  for (const r of rows) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cacheWriteTokens += r.cacheWriteTokens ?? 0;
    cacheReadTokens += r.cacheReadTokens ?? 0;
    const known = priceKnown(r.model);
    if (!known) unknown.add(r.model);
    costUsd = known && costUsd !== null ? costUsd + r.estimatedCostUsd : null;
    const cur = by.get(r.feature) ?? { calls: 0, costUsd: 0 };
    by.set(r.feature, { calls: cur.calls + 1, costUsd: known && cur.costUsd !== null ? cur.costUsd + r.estimatedCostUsd : null });
  }
  return {
    calls: rows.length,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    costUsd,
    unknownModels: Array.from(unknown),
    byFeature: Array.from(by.entries())
      .map(([feature, v]) => ({ feature, label: FEATURES[feature]?.label ?? feature, ...v }))
      .sort((a, b) => (b.costUsd ?? Infinity) - (a.costUsd ?? Infinity)),
  };
}

/** "—" for an unknown cost, never a made-up figure. */
export const money = (usd: number | null) => (usd === null ? "—" : usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`);
