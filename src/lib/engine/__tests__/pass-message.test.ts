import { describe, expect, it } from "vitest";
import { PASS_MESSAGE_DEFAULT, passMessageOutcome, passMessageWords, readPassMessage } from "@/lib/engine/pass-message";

describe("readPassMessage", () => {
  it("keeps one trimmed line", () => {
    expect(readPassMessage(`  ${PASS_MESSAGE_DEFAULT} `)).toEqual({ ok: true, value: PASS_MESSAGE_DEFAULT });
  });
  it("refuses blank, too long and several lines", () => {
    expect(readPassMessage("   ").ok).toBe(false);
    expect(readPassMessage("x".repeat(121)).ok).toBe(false);
    expect(readPassMessage("x".repeat(120)).ok).toBe(true);
    expect(readPassMessage("one\ntwo").ok).toBe(false);
  });
});

describe("passMessageOutcome", () => {
  it("maps statuses", () => {
    expect(passMessageOutcome(200)).toBe("sent");
    expect(passMessageOutcome(204)).toBe("sent");
    expect(passMessageOutcome(429)).toBe("busy");
    expect(passMessageOutcome(404)).toBe("failed-404");
    expect(passMessageOutcome(0)).toBe("failed-0");
  });
});

describe("passMessageWords", () => {
  it("says each outcome", () => {
    expect(passMessageWords("sent")?.good).toBe(true);
    expect(passMessageWords("busy")?.text).toContain("429");
    expect(passMessageWords("failed-401")?.text).toContain("key");
    expect(passMessageWords("failed-404")?.text).toContain("404");
    expect(passMessageWords("failed-0")?.text).toContain("no answer");
    expect(passMessageWords("failed-503")?.text).toContain("503");
    expect(passMessageWords("failed-400")?.text).toBe("eLoyalty refused the message (400).");
  });
  it("ignores anything unknown", () => {
    expect(passMessageWords(undefined)).toBeNull();
    expect(passMessageWords("<script>")).toBeNull();
    expect(passMessageWords("failed-12345")).toBeNull();
  });
});
