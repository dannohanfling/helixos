import { describe, expect, it } from "vitest";
import { isSealed, open, randomSecret, safeEqual, seal } from "../crypto";

describe("secrets at rest", () => {
  it("round-trips and never stores plaintext", () => {
    const s = seal("pit-super-secret-token")!;
    expect(isSealed(s)).toBe(true);
    expect(s).not.toContain("pit-super");
    expect(open(s)).toBe("pit-super-secret-token");
  });
  it("uses a fresh IV each time and leaves legacy plaintext readable", () => {
    expect(seal("x")).not.toBe(seal("x"));
    expect(open("legacy-plain")).toBe("legacy-plain");
    expect(seal("")).toBe("");
    expect(open(null)).toBeNull();
  });
  it("makes unpredictable secrets and compares in constant time", () => {
    const a = randomSecret();
    expect(a).toMatch(/^hx_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(randomSecret());
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});
