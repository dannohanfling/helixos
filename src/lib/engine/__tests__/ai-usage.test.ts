import { describe, expect, it } from "vitest";
import { FEATURES, MODELS, PRICES, estimateCost, explainAiError, modelFor, money, providerOfKey, rollup } from "../ai-usage";

describe("bring-your-own AI", () => {
  it("routes long-form drafting to the strong model and polish to the light one, on both providers", () => {
    expect(modelFor("anthropic", "webinar_section")).toBe(MODELS.anthropic.strong);
    expect(modelFor("anthropic", "ladder")).toBe(MODELS.anthropic.strong);
    expect(modelFor("anthropic", "composer_polish")).toBe(MODELS.anthropic.light);
    expect(modelFor("openai", "repurpose")).toBe(MODELS.openai.light);
    expect(modelFor("openai", "unknown_feature")).toBe(MODELS.openai.light);
    for (const f of Object.keys(FEATURES)) expect(PRICES[modelFor("anthropic", f)], f).toBeDefined();
  });

  it("estimates cost from list prices per million tokens", () => {
    expect(estimateCost("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(2);
    expect(estimateCost("claude-opus-5", 2000, 3000)).toBeCloseTo(0.01 + 0.075, 5);
    expect(money(0.004)).toBe("<$0.01");
    expect(money(1.5)).toBe("$1.50");
  });

  it("recognises which console a key came from", () => {
    expect(providerOfKey("sk-ant-api03-abcdefghijklmnop")).toBe("anthropic");
    expect(providerOfKey("sk-proj-abcdefghijklmnopqrstuvwxyz")).toBe("openai");
    expect(providerOfKey("sk-abcdefghijklmnopqrstuvwxyz")).toBe("openai");
    expect(providerOfKey("not a key")).toBeNull();
  });

  it("explains failures in plain words: bad key, no billing, permissions, rate limit", () => {
    expect(explainAiError("anthropic", 401, "invalid x-api-key")).toMatch(/rejected the key.*console\.anthropic\.com/);
    expect(explainAiError("anthropic", 400, "Your credit balance is too low")).toMatch(/no billing set up/);
    expect(explainAiError("openai", 429, "You exceeded your current quota, insufficient_quota")).toMatch(/no billing set up.*platform\.openai\.com/);
    expect(explainAiError("openai", 429, "Rate limit reached")).toMatch(/rate-limiting/);
    expect(explainAiError("anthropic", 403, "permission_error")).toMatch(/403/);
  });

  it("rolls usage up by feature with the costliest first", () => {
    const r = rollup([
      { feature: "ladder", inputTokens: 3000, outputTokens: 2000, estimatedCostUsd: 0.065 },
      { feature: "composer_polish", inputTokens: 500, outputTokens: 300, estimatedCostUsd: 0.004 },
      { feature: "ladder", inputTokens: 3000, outputTokens: 2000, estimatedCostUsd: 0.065 },
    ]);
    expect(r.calls).toBe(3);
    expect(r.inputTokens).toBe(6500);
    expect(r.costUsd).toBeCloseTo(0.134);
    expect(r.byFeature[0]).toMatchObject({ feature: "ladder", label: "Comment ladders", calls: 2 });
  });
});
