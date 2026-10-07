import { describe, expect, it } from "vitest";
import { KIT_STATUS_WORDS, kitStatus } from "../brand-kit";

describe("a member's brand kit status (rev 568)", () => {
  it("is starter with no kit of their own, in progress with one but no logo, set once a logo is picked", () => {
    expect(kitStatus(null)).toBe("starter");
    expect(kitStatus(undefined)).toBe("starter");
    expect(kitStatus({ logoImageId: null, logoDarkImageId: null })).toBe("in progress");
    expect(kitStatus({ logoImageId: "img", logoDarkImageId: null })).toBe("set");
    expect(kitStatus({ logoImageId: null, logoDarkImageId: "dark" })).toBe("set");
    expect(KIT_STATUS_WORDS.starter).toBe("starter kit");
  });
});
