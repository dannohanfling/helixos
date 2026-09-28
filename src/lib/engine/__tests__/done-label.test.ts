import { describe, expect, it } from "vitest";
import { doneLabel, isErrorAnswer } from "../done-label";

describe("the green confirmation's words", () => {
  it("turns the working label into what happened", () => {
    expect(doneLabel("Saving…")).toBe("Saved ✓");
    expect(doneLabel(undefined)).toBe("Saved ✓");
    expect(doneLabel("Sending to your bot…")).toBe("Sent ✓");
    expect(doneLabel("Adding…")).toBe("Added ✓");
    expect(doneLabel("Locking in…")).toBe("Locked in ✓");
    expect(doneLabel("Saving your day…")).toBe("Saved ✓");
    expect(doneLabel("Frobbing…")).toBe("Done ✓");
  });
  it("confirms nothing for a button that takes you somewhere", () => {
    expect(doneLabel("Logging out…")).toBeNull();
    expect(doneLabel("Signing in…")).toBeNull();
    expect(doneLabel("Opening…")).toBeNull();
  });
  it("knows an error answer from the address", () => {
    expect(isErrorAnswer("?error=Nope")).toBe(true);
    expect(isErrorAnswer("?saved=1&weekError=x")).toBe(true);
    expect(isErrorAnswer("?weekSaved=1")).toBe(false);
    expect(isErrorAnswer("")).toBe(false);
  });
});
