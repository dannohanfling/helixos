import { describe, expect, it } from "vitest";
import { buildProposals, MAX_PROPOSALS, setupReadBack, tickedByDefault, type SetupLook } from "@/lib/engine/board-setup";
import type { BoardAnswer } from "@/lib/engine/board";

// Monday 12 October 2026.
const TODAY = "2026-10-12";
const answer: BoardAnswer = {
  decision: "Put this week into DMs",
  assumptions: [],
  advisors: [],
  split: "",
  recommendation: "DMs first",
  steps: [
    { do: "Message 10 past clients", by: "2026-10-13", takesMinutes: 60, doneWhen: "10 sent", first5: "Pin the names", dependsOn: null },
    { do: "Write the one-line offer", by: "2026-10-15", takesMinutes: 30, doneWhen: "On the page", first5: "Open the offer", dependsOn: null },
  ],
  youDecide: "You decide.",
};
const look = (over: Partial<SetupLook> = {}): SetupLook => ({
  today: TODAY,
  link: "https://app.test/my-board/d1",
  question: "Should I run a webinar or DM? I want 4 calls booked.",
  known: "Cash collected 2,500 this month",
  intention: null,
  month: "2026-10",
  targets: {},
  contacts: [
    { id: "c1", name: "Priya Shah", stage: "conversation", nextFollowUpAt: null },
    { id: "c2", name: "Cold Carl", stage: "cold", nextFollowUpAt: null },
    { id: "c3", name: "Sam Lee", stage: "replied", nextFollowUpAt: "2026-10-14" },
  ],
  offers: [{ id: "o1", name: "Spring Reset Workshop" }],
  oohCategories: ["Sales", "Marketing", "Other"],
  fridays: ["2026-10-16", "2026-10-23"],
  ...over,
});

describe("Set it up for me (rev 660)", () => {
  it("turns every step into a task (step 1 in Top 3 on its day, Done when and First 5 minutes in the notes, linked back) and adds the check-in on the last step's date", () => {
    const { proposals } = buildProposals(answer, null, look());
    expect(proposals.map((p) => p.kind)).toEqual(["task", "task", "checkin"]);
    expect(proposals[0].payload).toMatchObject({ urgency: "top3", dueDate: "2026-10-13", category: "sales", step: 0 });
    expect(proposals[1].payload).toMatchObject({ urgency: "high", step: 1 });
    expect(String(proposals[0].payload.details)).toMatch(/Done when: 10 sent\nFirst 5 minutes: Pin the names\nFrom My Board: https:\/\/app.test\/my-board\/d1/);
    expect(proposals[2].payload).toMatchObject({ dueDate: "2026-10-15" });
    expect(proposals.every(tickedByDefault)).toBe(true);
  });

  it("keeps a number only when the member gave it: an invented target or price is left out and said", () => {
    const { proposals, notes } = buildProposals(answer, [{ kind: "target", metric: "callsBooked", value: 4 }, { kind: "target", metric: "cashCollected", value: 9999 }, { kind: "target", metric: "offersMade", value: 2500 }, { kind: "offer", name: "DM Sprint", price: 9999 }], look());
    const targets = proposals.filter((p) => p.kind === "target");
    expect(targets.map((t) => t.payload.metric)).toEqual(["callsBooked", "offersMade"]);
    expect(notes.join(" ")).toMatch(/cash collected target of 9999: that number isn't one you gave/);
    expect(proposals.find((p) => p.kind === "offer")!.payload.price).toBeNull();
    expect(notes.join(" ")).toMatch(/"DM Sprint" has no price/);
  });

  it("shows a change to something that exists as before → after, never ticked for the member", () => {
    const { proposals } = buildProposals(answer, [{ kind: "target", metric: "callsBooked", value: 4 }, { kind: "intention", word: "Reach", keyResults: ["a", "b", "c"], initiative: "i", tasks: ["x", "y", "z"] }, { kind: "followup", name: "Sam", by: "2026-10-16" }], look({ targets: { callsBooked: 2 }, intention: { word: "Calm", keyResults: ["q", "r", "s"], initiative: "j", tasks: ["t", "u", "v"] } }));
    const t = proposals.find((p) => p.kind === "target")!;
    expect([t.before, t.after]).toEqual(["Calls booked: 2", "Calls booked: 4"]);
    const i = proposals.find((p) => p.kind === "intention")!;
    expect(i.before).toBe("Calm: q; r; s");
    const f = proposals.find((p) => p.kind === "followup")!;
    expect(f.before).toMatch(/Wed, Oct 14/);
    expect([t, i, f].some(tickedByDefault)).toBe(false);
  });

  it("only names people already in their DMs, never a cold one or a client for a follow-up", () => {
    const { proposals, notes } = buildProposals(answer, [{ kind: "followup", name: "Zed" }, { kind: "followup", name: "Carl" }, { kind: "followup", name: "Priya", by: "2026-10-17" }, { kind: "proof", name: "Priya" }], look());
    expect(proposals.filter((p) => p.kind === "followup").map((p) => p.payload.contactId)).toEqual(["c1"]);
    // Saturday the 17th moves to Monday the 19th.
    expect(proposals.find((p) => p.kind === "followup")!.payload.by).toBe("2026-10-19");
    expect(proposals.find((p) => p.kind === "proof")!.payload).toMatchObject({ contactId: "c1", dueDate: TODAY });
    expect(notes.join(" ")).toMatch(/"Zed": they aren't in your DMs/);
  });

  it("drafts only: content dated on a working day (a past date becomes today), a webinar with the offer it named, an offer marked as a draft", () => {
    const { proposals } = buildProposals(answer, [{ kind: "content", title: "Why DMs", date: "2026-10-01" }, { kind: "webinar", title: "Spring Live", date: "2026-10-18", offer: "spring reset" }, { kind: "offer", name: "DM Sprint" }], look());
    expect(proposals.find((p) => p.kind === "content")!.payload.date).toBe(TODAY);
    expect(proposals.find((p) => p.kind === "webinar")!.payload).toMatchObject({ date: "2026-10-19", offerId: "o1" });
    expect(proposals.find((p) => p.kind === "offer")!.detail).toMatch(/Draft from Board.*not live, not on your bot/);
  });

  it("reads Office Hours back with the next Friday and a real category, and never ticks it for the member", () => {
    const { proposals } = buildProposals(answer, [{ kind: "office_hours", question: "Webinar or DMs?", tried: "Mapped my hours", outcome: "A clear answer", category: "Nope" }], look());
    const o = proposals.find((p) => p.kind === "office_hours")!;
    // A category the workspace doesn't have goes under Other, never a guess at another.
    expect(o.payload).toMatchObject({ friday: "2026-10-16", category: "Other" });
    expect(o.detail).toMatch(/Friday the 16th, under Other/);
    expect(tickedByDefault(o)).toBe(false);
  });

  it("stops at seven and says what Jordan left out", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ kind: "content", title: `Idea ${i + 1}` }));
    const { proposals, notes } = buildProposals(answer, many, look());
    expect(proposals).toHaveLength(MAX_PROPOSALS);
    expect(notes.filter((n) => n.startsWith("Jordan kept the set-up to 7"))).toHaveLength(2);
    expect(setupReadBack(proposals.slice(0, 2))).toMatch(/^1\. Message 10 past clients: Top 3 on Tue, Oct 13/);
  });
});
