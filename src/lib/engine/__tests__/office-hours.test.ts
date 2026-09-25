import { describe, expect, it } from "vitest";
import { GO_BACK, OOH_CATEGORIES_DEFAULT, oohEditable, readList, readOohRequest, upcomingFridays } from "../office-hours";

const base = { friday: "2026-09-25", description: "My bot books the wrong calendar.", triedSelf: "Re-read the setup lesson.", tools: "Community Loyalty", goal: "Bookings land on the right calendar.", category: "Chatbot", triedGate: "yes", promise: true };

describe("Open Office Hours requests (handoff rev 124)", () => {
  it("offers only this month's upcoming Fridays, a Friday today included", () => {
    expect(upcomingFridays("2026-09-01")).toEqual(["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(upcomingFridays("2026-09-25")).toEqual(["2026-09-25"]);
    expect(upcomingFridays("2026-09-26")).toEqual([]);
    expect(upcomingFridays("2026-10-01")).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
  });
  it("a request can be changed up to and including its Friday", () => {
    expect(oohEditable("2026-09-24", "2026-09-25")).toBe(true);
    expect(oohEditable("2026-09-25", "2026-09-25")).toBe(true);
    expect(oohEditable("2026-09-26", "2026-09-25")).toBe(false);
  });
  it("the two gates come first: going back saves nothing and says so kindly; the promise must be ticked", () => {
    expect(readOohRequest({ ...base, triedGate: GO_BACK }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toHaveProperty("goBack");
    expect(readOohRequest({ ...base, triedGate: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Tell us whether you've tried to overcome this yourself." });
    expect(readOohRequest({ ...base, promise: false }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Promise to attend the call, so your spot isn't wasted." });
  });
  it("then the fields: an upcoming Friday this month, the issue, what they tried, the goal and a listed category; tools optional", () => {
    expect(readOohRequest({ ...base, tools: " " }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ value: { ...base, tools: "", triedGate: undefined, promise: undefined } });
    expect(readOohRequest({ ...base, friday: "2026-09-18" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Pick one of this month's upcoming Fridays." });
    expect(readOohRequest({ ...base, friday: "2026-10-02" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Pick one of this month's upcoming Fridays." });
    expect(readOohRequest({ ...base, description: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Describe the issue." });
    expect(readOohRequest({ ...base, triedSelf: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Say how you tried to solve it yourself." });
    expect(readOohRequest({ ...base, goal: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Say what solution we're trying to reach on the call." });
    expect(readOohRequest({ ...base, category: "Taxes" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ error: "Pick a category." });
    expect(readOohRequest({ ...base, category: "Taxes" }, "2026-09-24", [...OOH_CATEGORIES_DEFAULT, "Taxes"])).toHaveProperty("value");
  });
  it("the coach's lists: one per line, trimmed, no blanks or repeats", () => {
    expect(readList(" Chatbot \n\nFunnels\nChatbot\n")).toEqual(["Chatbot", "Funnels"]);
  });
});
