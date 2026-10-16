import { describe, expect, it } from "vitest";
import { stagingSeedRefusal } from "@/lib/staging-seed";

const TOKEN = "a-long-setup-token-of-thirty-two-chars";

describe("the staging seed route answers only on a preview with the token and the seed switch (H-349 §1)", () => {
  it("refuses production, a missing or short token, a wrong token and a preview without ALLOW_DEMO_SEED", () => {
    expect(stagingSeedRefusal({ VERCEL_ENV: "production", SETUP_TOKEN: TOKEN, ALLOW_DEMO_SEED: "1" }, TOKEN)).toBe("not-a-preview");
    expect(stagingSeedRefusal({ VERCEL_ENV: "preview", ALLOW_DEMO_SEED: "1" }, TOKEN)).toBe("no-token");
    expect(stagingSeedRefusal({ VERCEL_ENV: "preview", SETUP_TOKEN: "short", ALLOW_DEMO_SEED: "1" }, "short")).toBe("no-token");
    expect(stagingSeedRefusal({ VERCEL_ENV: "preview", SETUP_TOKEN: TOKEN, ALLOW_DEMO_SEED: "1" }, "nope")).toBe("wrong-token");
    expect(stagingSeedRefusal({ VERCEL_ENV: "preview", SETUP_TOKEN: TOKEN }, TOKEN)).toBe("seed-off");
  });
  it("allows a preview with the right token and the switch, and a local development run", () => {
    expect(stagingSeedRefusal({ VERCEL_ENV: "preview", SETUP_TOKEN: TOKEN, ALLOW_DEMO_SEED: "1" }, TOKEN)).toBeNull();
    expect(stagingSeedRefusal({ NODE_ENV: "development", SETUP_TOKEN: TOKEN, ALLOW_DEMO_SEED: "1" }, TOKEN)).toBeNull();
    expect(stagingSeedRefusal({ NODE_ENV: "production", SETUP_TOKEN: TOKEN, ALLOW_DEMO_SEED: "1" }, TOKEN)).toBe("not-a-preview");
  });
});
