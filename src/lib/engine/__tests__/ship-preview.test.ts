import { describe, expect, it } from "vitest";
import { PREVIEW_TTL_MS, checkPreviewToken, issuePreviewToken } from "@/lib/ship-preview";

/** The preview token (rev 638): only the exact Ship that was read back, by the same member, within fifteen minutes. */
describe("ship preview token", () => {
  const want = { userId: "u1", ladderId: "l1", channels: ["page", "instagram"], fingerprint: "fp" };
  const now = 1_800_000_000_000;
  const t = issuePreviewToken(want, now);
  it("passes for the Ship it was given for, channels in any order", () => {
    expect(checkPreviewToken(t, want, now + 60_000)).toEqual({ ok: true });
    expect(checkPreviewToken(t, { ...want, channels: ["instagram", "page"] }, now)).toEqual({ ok: true });
  });
  it("refuses a stale, foreign, edited, re-channelled or forged token", () => {
    expect(checkPreviewToken(t, want, now + PREVIEW_TTL_MS + 1)).toMatchObject({ ok: false, why: expect.stringContaining("15 minutes") });
    expect(checkPreviewToken(t, { ...want, ladderId: "l2" }, now)).toMatchObject({ ok: false, why: expect.stringContaining("another ladder") });
    expect(checkPreviewToken(t, { ...want, userId: "u2" }, now)).toMatchObject({ ok: false });
    expect(checkPreviewToken(t, { ...want, fingerprint: "fp2" }, now)).toMatchObject({ ok: false, why: expect.stringContaining("changed") });
    expect(checkPreviewToken(t, { ...want, channels: ["page"] }, now)).toMatchObject({ ok: false, why: expect.stringContaining("other channels") });
    const [body] = t.split(".");
    expect(checkPreviewToken(`${body}.forged`, want, now)).toMatchObject({ ok: false, why: expect.stringContaining("isn't one HelixOS gave") });
    expect(checkPreviewToken("", want, now)).toMatchObject({ ok: false });
  });
});
