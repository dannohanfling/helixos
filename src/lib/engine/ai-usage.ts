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
  key_check: { label: "Key check", tier: "light" },
};

export const MODELS: Record<AiProvider, Record<Tier, string>> = {
  anthropic: { strong: "claude-opus-5", light: "claude-sonnet-5" },
  openai: { strong: "gpt-4.1", light: "gpt-4.1-mini" },
};

/** USD per million tokens [input, output]. Anthropic from the current price list; OpenAI list prices at time of writing. Update here only. */
export const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
};

export function modelFor(provider: AiProvider, feature: string): string {
  return MODELS[provider][FEATURES[feature]?.tier ?? "light"];
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const [pin, pout] = PRICES[model] ?? [5, 25];
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

/** A key's shape says which console it came from. Catches the most common mistake before a network call. */
export function providerOfKey(key: string): AiProvider | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (/^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{4,}$/.test(k)) return "openai";
  return null;
}

/** Turns an SDK error into the sentence a business owner needs. */
export function explainAiError(provider: AiProvider, status: number | undefined, message: string): string {
  const m = message.toLowerCase();
  const console_ = provider === "anthropic" ? "console.anthropic.com" : "platform.openai.com";
  if (status === 401 || /invalid api key|authentication|incorrect api key/.test(m)) return `${provider === "anthropic" ? "Anthropic" : "OpenAI"} rejected the key (401). Paste it again from ${console_}, all of it, with no spaces.`;
  if (/credit balance|insufficient_quota|billing|exceeded your current quota|purchase credits/.test(m) || status === 402) return `The key works but the account has no billing set up. Add a payment method or credits at ${console_}, then check again.`;
  if (status === 403 || /permission/.test(m)) return `The key doesn't have permission to use the model (403). Create a new key at ${console_} without restrictions.`;
  if (status === 429) return "The provider is rate-limiting this key right now. The key itself is fine; try again in a minute.";
  if (status === 404 || /model/.test(m)) return "The provider doesn't recognise the model for this key. Check the account has access to current models.";
  if (/fetch failed|econn|network|timeout/.test(m)) return "Couldn't reach the provider. Check the connection and try again.";
  return `The provider returned an error: ${message.slice(0, 160)}`;
}

export type UsageRollup = { calls: number; inputTokens: number; outputTokens: number; costUsd: number; byFeature: { feature: string; label: string; calls: number; costUsd: number }[] };

export function rollup(rows: Pick<AiUsage, "feature" | "inputTokens" | "outputTokens" | "estimatedCostUsd">[]): UsageRollup {
  const by = new Map<string, { calls: number; costUsd: number }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const r of rows) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    costUsd += r.estimatedCostUsd;
    const cur = by.get(r.feature) ?? { calls: 0, costUsd: 0 };
    by.set(r.feature, { calls: cur.calls + 1, costUsd: cur.costUsd + r.estimatedCostUsd });
  }
  return {
    calls: rows.length,
    inputTokens,
    outputTokens,
    costUsd,
    byFeature: Array.from(by.entries())
      .map(([feature, v]) => ({ feature, label: FEATURES[feature]?.label ?? feature, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

export const money = (usd: number) => (usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`);
