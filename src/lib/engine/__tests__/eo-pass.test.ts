import { describe, expect, it } from "vitest";
import { createFailureWords, passNames, passOffer, refusalReason, safePassUrl } from "../eo-pass";
import { address, isPlaceholderName } from "../eloyalty";

// The placeholders on the live Evolve Omega template (H-798, H-817).
const EVOLVE_OMEGA_PLACEHOLDERS = ["First_Name", "Last_Name", "Email", "MEMBER_ID", "Push_Notification", "Points", "Tier", "Current_Offer"];

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

describe("a refused pass says why (H-923)", () => {
  it("reads eLoyalty's reason from the usual answer shapes", () => {
    expect(refusalReason({ error: "MEMBER_ID is required" })).toBe("MEMBER_ID is required");
    expect(refusalReason({ message: "Validation failed", errors: [{ field: "Points", message: "must be a number" }] })).toBe("Points: must be a number");
    expect(refusalReason({ errors: ["First_Name too long", "Tier unknown"] })).toBe("First_Name too long; Tier unknown");
    expect(refusalReason(null)).toBeNull();
    expect(refusalReason({})).toBeNull();
  });
  it("never carries a member's detail: no email, link, quoted value or long number, at most 160 characters", () => {
    const r = refusalReason({ error: "Email 'maya@example.com' already used by customer 123456789, see https://x.example/c/1 or \"Maya Torres\"" })!;
    expect(r).not.toMatch(/maya|example\.com|123456789|https|Torres/i);
    expect(refusalReason({ error: "x".repeat(400) })!.length).toBe(160);
  });
  it("says to wait only when eLoyalty is busy or failing", () => {
    expect(createFailureWords(400, "MEMBER_ID is required")).toBe("eLoyalty refused the pass (400): MEMBER_ID is required.");
    expect(createFailureWords(400, null)).toBe("eLoyalty refused the pass (400).");
    expect(createFailureWords(403, null)).toMatch(/refused the program's key \(403\).*allowed templates/);
    expect(createFailureWords(404, null)).toMatch(/could not find the pass template/);
    expect(createFailureWords(429, null)).toMatch(/Try again in a minute/);
    expect(createFailureWords(503, null)).toMatch(/Try again in a minute/);
    expect(createFailureWords(400, null)).not.toMatch(/Try again in a minute/);
  });
  it("sends the template's own MEMBER_ID with the pass, the same as Id", () => {
    const a = address("createPass", {}, { templateId: "t1", email: "e@x.test", firstName: "A", lastName: "B", externalId: "m1" });
    // Only the Evolve Omega template's placeholders (H-798): an unknown field such as Id is refused with a 400 (H-1235).
    expect(a.ok && a.body).toEqual({ Email: "e@x.test", First_Name: "A", Last_Name: "B", MEMBER_ID: "m1" });
    expect(Object.keys(a.ok ? (a.body as object) : {}).every((k) => EVOLVE_OMEGA_PLACEHOLDERS.includes(k))).toBe(true);
  });
  it("never sends an empty or placeholder name, so the pass never shows the template's prompt (H-1640)", () => {
    const one = address("createPass", {}, { templateId: "t1", email: "e@x.test", ...passNames("Danno"), externalId: "m1" });
    expect(one.ok && one.body).toEqual({ Email: "e@x.test", First_Name: "Danno", MEMBER_ID: "m1" });
    const prompt = address("createPass", {}, { templateId: "t1", email: "e@x.test", firstName: "Maya", lastName: "Enter Your Last Name Here", externalId: "m1" });
    expect(prompt.ok && prompt.body).toEqual({ Email: "e@x.test", First_Name: "Maya", MEMBER_ID: "m1" });
    const blank = address("createPass", {}, { templateId: "t1", email: "e@x.test", firstName: "  ", lastName: "", externalId: "m1" });
    expect(blank.ok && blank.body).toEqual({ Email: "e@x.test", MEMBER_ID: "m1" });
    expect(isPlaceholderName("Last Name")).toBe(true);
    expect(isPlaceholderName("your first name")).toBe(true);
    expect(isPlaceholderName("Torres")).toBe(false);
    expect(isPlaceholderName("Lastname-Smith")).toBe(false);
  });
});
