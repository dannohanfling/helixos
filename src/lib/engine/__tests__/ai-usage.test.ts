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

  it("estimates cost from list prices per million tokens, and the OpenAI tiers price-match the Anthropic ones", () => {
    expect(estimateCost("claude-sonnet-5", 1_000_000, 0)).toBeCloseTo(2);
    expect(estimateCost("claude-opus-5", 2000, 3000)).toBeCloseTo(0.01 + 0.075, 5);
    // The Essence prefix: written at 1.25× the input price, read back at 0.1×
    expect(estimateCost("claude-sonnet-5", 1000, 0, 2000, 0)).toBeCloseTo((1000 * 2 + 2000 * 2 * 1.25) / 1_000_000, 9);
    expect(estimateCost("claude-sonnet-5", 1000, 0, 0, 2000)).toBeCloseTo((1000 * 2 + 2000 * 2 * 0.1) / 1_000_000, 9);
    expect(estimateCost(MODELS.openai.strong, 2000, 3000)).toBe(estimateCost(MODELS.anthropic.strong, 2000, 3000));
    expect(estimateCost(MODELS.openai.light, 2000, 3000)).toBe(estimateCost(MODELS.anthropic.light, 2000, 3000));
    expect(MODELS.openai).toEqual({ strong: "gpt-6-astra", light: "gpt-5.6-sol" });
    expect(money(0.004)).toBe("<$0.01");
    expect(money(1.5)).toBe("$1.50");
  });

  it("never fails open on an unknown model: cost is null and shows as a dash", () => {
    expect(estimateCost("some-future-model", 1000, 1000)).toBeNull();
    expect(money(null)).toBe("—");
    const r = rollup([
      { feature: "ladder", model: "claude-opus-5", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 0.03 },
      { feature: "ladder", model: "some-future-model", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 0 },
    ]);
    expect(r.costUsd).toBeNull();
    expect(r.unknownModels).toEqual(["some-future-model"]);
    expect(r.byFeature[0].costUsd).toBeNull();
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
    expect(explainAiError("openai", 404, "The model `gpt-6-astra` does not exist or you do not have access to it.", "gpt-6-astra")).toMatch(/account does not have access to the model gpt-6-astra/);
    expect(explainAiError("anthropic", 404, "model: claude-sonnet-5", "claude-sonnet-5")).toMatch(/does not have access to the model claude-sonnet-5/);
  });

  it("rolls usage up by feature with the costliest first", () => {
    const r = rollup([
      { feature: "ladder", model: "claude-opus-5", inputTokens: 3000, outputTokens: 2000, estimatedCostUsd: 0.065 },
      { feature: "composer_polish", model: "claude-sonnet-5", inputTokens: 500, outputTokens: 300, estimatedCostUsd: 0.004 },
      { feature: "ladder", model: "claude-opus-5", inputTokens: 3000, outputTokens: 2000, estimatedCostUsd: 0.065 },
    ]);
    expect(r.calls).toBe(3);
    expect(r.inputTokens).toBe(6500);
    expect(r.costUsd).toBeCloseTo(0.134);
    expect(r.byFeature[0]).toMatchObject({ feature: "ladder", label: "Comment ladders", calls: 2 });
  });
});
