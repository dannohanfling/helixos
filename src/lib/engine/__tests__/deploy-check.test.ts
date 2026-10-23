import { describe, expect, it } from "vitest";
import { staleBuild } from "@/lib/engine/deploy-check";

describe("staleBuild", () => {
  it("is stale only when two real commits differ", () => {
    expect(staleBuild("5e6f35b", "9e9b1ec")).toBe(true);
    expect(staleBuild("5e6f35b", "5e6f35b")).toBe(false);
  });
  it("never counts a dev build or an odd answer", () => {
    expect(staleBuild("dev", "9e9b1ec")).toBe(false);
    expect(staleBuild("5e6f35b", "dev")).toBe(false);
    expect(staleBuild("5e6f35b", undefined)).toBe(false);
    expect(staleBuild("5e6f35b", "<html>")).toBe(false);
  });
});
