import { describe, expect, it } from "vitest";
import { EMAIL_CHANGE_SAID, emailChangeProblem, maskEmail } from "../account";

describe("changing a login email (H-47)", () => {
  it("masks an address to its first and last letter and the domain", () => {
    expect(maskEmail("danno.promo@gmail.com")).toBe("d•••o@gmail.com");
    expect(maskEmail("a@x.io")).toBe("a•••@x.io");
    expect(maskEmail("nonsense")).toBe("•••");
  });
  it("checks the new address without saying whether anyone has it", () => {
    expect(emailChangeProblem("me@x.io", "me@x.io")).toBe("That's already your login email.");
    expect(emailChangeProblem("me@x.io", "not an email")).toBe("That doesn't look like an email address.");
    expect(emailChangeProblem("me@x.io", "New@Y.io")).toBeNull();
    expect(EMAIL_CHANGE_SAID).not.toMatch(/already|taken|in use/i);
  });
});
