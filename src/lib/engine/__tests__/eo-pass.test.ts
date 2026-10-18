import { describe, expect, it } from "vitest";
import { passNames, passOffer, safePassUrl } from "../eo-pass";

/** The Evolve Omega pass (H-622): who may get one, the names it carries, and the only links kept. */
describe("the Evolve Omega pass", () => {
  const ready = { ready: true, issuePasses: false };
  it("offers Get my pass to the coach on a ready program, to clients only once passes are on, and never twice", () => {
    expect(passOffer({ role: "coach", hasPass: false, installed: false }, ready)).toEqual({ kind: "get" });
    expect(passOffer({ role: "client", hasPass: false, installed: false }, ready)).toMatchObject({ kind: "closed", why: expect.stringContaining("your coach opens it") });
    expect(passOffer({ role: "client", hasPass: false, installed: false }, { ...ready, issuePasses: true })).toEqual({ kind: "get" });
    expect(passOffer({ role: "client", hasPass: true, installed: true }, { ...ready, issuePasses: true })).toEqual({ kind: "has", installed: true });
  });
  it("offers nothing while the program is not ready, to the coach too", () => {
    for (const p of [null, { ready: false, issuePasses: true }]) {
      expect(passOffer({ role: "coach", hasPass: false, installed: false }, p)).toMatchObject({ kind: "closed", why: expect.stringContaining("being set up") });
    }
  });
  it("splits the one name field into first and last for the pass", () => {
    expect(passNames("Ana Sofia Reyes")).toEqual({ firstName: "Ana Sofia", lastName: "Reyes" });
    expect(passNames("  Danno  ")).toEqual({ firstName: "Danno", lastName: "" });
    expect(passNames("")).toEqual({ firstName: "", lastName: "" });
  });
  it("keeps only a real https wallet link", () => {
    expect(safePassUrl("https://pass.example/eo-1")).toBe("https://pass.example/eo-1");
    for (const bad of ["http://pass.example/x", "javascript:alert(1)", "https://x y/z", "", null, undefined]) expect(safePassUrl(bad)).toBeNull();
  });
});
