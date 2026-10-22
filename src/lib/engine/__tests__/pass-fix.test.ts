import { describe, expect, it } from "vitest";
import { answerHasPlaceholder, fixFields, fixOutcome, fixWords } from "@/lib/engine/pass-fix";

describe("fixFields", () => {
  it("writes first and last from HelixOS, blank last when there is none", () => {
    expect(fixFields("Danno Hanfling")).toEqual([
      { field: "First_Name", value: "Danno" },
      { field: "Last_Name", value: "Hanfling" },
    ]);
    expect(fixFields("Danno")).toEqual([
      { field: "First_Name", value: "Danno" },
      { field: "Last_Name", value: "" },
    ]);
  });
  it("never writes prompt text", () => {
    expect(fixFields("Maya Enter Your Last Name Here").every((f) => !/enter your/i.test(f.value))).toBe(true);
  });
});

describe("fixOutcome", () => {
  it("maps the writes' statuses", () => {
    expect(fixOutcome([200, 204])).toBe("updated");
    expect(fixOutcome([200, 429])).toBe("busy");
    expect(fixOutcome([400, 200])).toBe("failed-400");
    expect(fixOutcome([])).toBe("failed-0");
  });
});

describe("fixWords", () => {
  it("says each outcome without naming the provider", () => {
    for (const code of ["updated", "busy", "nopass", "notready", "proving", "failed-400", "failed-404", "failed-0", "failed-503"]) {
      const w = fixWords(code);
      expect(w).not.toBeNull();
      expect(w!.text).not.toMatch(/eloyalty|walletpush/i);
    }
    expect(fixWords("failed-400")!.text).toMatch(/reissue/);
    expect(fixWords("<x>")).toBeNull();
  });
});

describe("answerHasPlaceholder", () => {
  it("finds prompt text anywhere in a create answer", () => {
    expect(answerHasPlaceholder({ customerId: "c", fields: { Last_Name: "Enter Your Last Name Here" } })).toBe(true);
    expect(answerHasPlaceholder({ customerId: "c", First_Name: "Danno" })).toBe(false);
  });
});
