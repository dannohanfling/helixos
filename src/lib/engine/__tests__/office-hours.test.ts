import { describe, expect, it } from "vitest";
import { GO_BACK, OOH_CATEGORIES_DEFAULT, attendeeWords, oohAttendees, oohCanEdit, oohEditable, oohNoticeWords, oohVisibleTo, readAttendees, readList, readOohRequest, readOthers, submittedByWords, upcomingFridays } from "../office-hours";

const base = { friday: "2026-09-25", description: "My bot books the wrong calendar.", triedSelf: "Re-read the setup lesson.", tools: "Community Loyalty", goal: "Bookings land on the right calendar.", category: "Chatbot", triedGate: "yes", promise: true };

describe("Open Office Hours requests (handoff rev 124)", () => {
  it("offers the next four Fridays, a Friday today included, across month ends: no dead days (rev 129)", () => {
    expect(upcomingFridays("2026-09-01")).toEqual(["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
    expect(upcomingFridays("2026-09-25")).toEqual(["2026-09-25", "2026-10-02", "2026-10-09", "2026-10-16"]);
    expect(upcomingFridays("2026-09-26")).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"]);
    expect(upcomingFridays("2026-12-27")).toEqual(["2027-01-01", "2027-01-08", "2027-01-15", "2027-01-22"]);
  });
  it("a request can be changed up to and including its Friday", () => {
    expect(oohEditable("2026-09-24", "2026-09-25")).toBe(true);
    expect(oohEditable("2026-09-25", "2026-09-25")).toBe(true);
    expect(oohEditable("2026-09-26", "2026-09-25")).toBe(false);
  });
  it("the two gates come first: going back saves nothing and says so kindly; the promise must be ticked", () => {
    expect(readOohRequest({ ...base, triedGate: GO_BACK }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toHaveProperty("goBack");
    expect(readOohRequest({ ...base, triedGate: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Tell us whether you've tried to overcome this yourself." });
    expect(readOohRequest({ ...base, promise: false }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Promise to attend the call, so your spot isn't wasted." });
  });
  it("then the fields: one of the next four Fridays, the issue, what they tried, the goal and a listed category; tools optional", () => {
    expect(readOohRequest({ ...base, tools: " " }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toEqual({ value: { ...base, tools: "", triedGate: undefined, promise: undefined } });
    expect(readOohRequest({ ...base, friday: "2026-09-18" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Pick one of the next four Fridays." });
    expect(readOohRequest({ ...base, friday: "2026-10-16" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toHaveProperty("value");
    expect(readOohRequest({ ...base, friday: "2026-10-23" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Pick one of the next four Fridays." });
    expect(readOohRequest({ ...base, description: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Describe the issue." });
    expect(readOohRequest({ ...base, triedSelf: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Say how you tried to solve it yourself." });
    expect(readOohRequest({ ...base, goal: "" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Say what solution we're trying to reach on the call." });
    expect(readOohRequest({ ...base, category: "Taxes" }, "2026-09-24", OOH_CATEGORIES_DEFAULT)).toMatchObject({ error: "Pick a category." });
    expect(readOohRequest({ ...base, category: "Taxes" }, "2026-09-24", [...OOH_CATEGORIES_DEFAULT, "Taxes"])).toHaveProperty("value");
  });
  it("the coach's lists: one per line, trimmed, no blanks or repeats", () => {
    expect(readList(" Chatbot \n\nFunnels\nChatbot\n")).toEqual(["Chatbot", "Funnels"]);
  });
});

describe("Office Hours for a team (H-413): who sees, who edits, who attends", () => {
  const owner = { ownerId: "u-owner", actorId: "u-owner", team: false };
  const sam = { ownerId: "u-owner", actorId: "u-sam", team: true };
  const tess = { ownerId: "u-owner", actorId: "u-tess", team: true };
  const ownersOwn = { userId: "u-owner", submittedByUserId: null, attendeeUserIds: [] as string[] };
  const samsForOwner = { userId: "u-owner", submittedByUserId: "u-sam", attendeeUserIds: ["u-owner", "u-sam"] };
  const ownersWithTess = { userId: "u-owner", submittedByUserId: null, attendeeUserIds: ["u-owner", "u-tess"] };
  it("the owner sees every request; a team member only the ones they submitted or attend", () => {
    expect([ownersOwn, samsForOwner, ownersWithTess].map((r) => oohVisibleTo(r, owner))).toEqual([true, true, true]);
    expect([ownersOwn, samsForOwner, ownersWithTess].map((r) => oohVisibleTo(r, sam))).toEqual([false, true, false]);
    expect([ownersOwn, samsForOwner, ownersWithTess].map((r) => oohVisibleTo(r, tess))).toEqual([false, false, true]);
  });
  it("nobody picked reads as the owner alone", () => {
    expect(oohAttendees(ownersOwn)).toEqual(["u-owner"]);
    expect(oohAttendees(samsForOwner)).toEqual(["u-owner", "u-sam"]);
  });
  it("the owner or the submitter may change a request until its Friday; attending alone does not, and nothing after", () => {
    expect(oohCanEdit(samsForOwner, owner, "2026-10-20", "2026-10-23")).toBe(true);
    expect(oohCanEdit(samsForOwner, sam, "2026-10-20", "2026-10-23")).toBe(true);
    expect(oohCanEdit(samsForOwner, tess, "2026-10-20", "2026-10-23")).toBe(false);
    expect(oohCanEdit(ownersWithTess, tess, "2026-10-20", "2026-10-23")).toBe(false);
    expect(oohCanEdit(samsForOwner, sam, "2026-10-24", "2026-10-23")).toBe(false);
    expect(oohCanEdit(ownersOwn, owner, "2026-10-24", "2026-10-23")).toBe(false);
  });
  it("the attendees a form may name are the owner and the account's live team, nothing else; nobody picked means the owner", () => {
    expect(readAttendees(["u-sam", "u-owner", "u-sam", "u-stranger", " "], ["u-sam", "u-tess"], "u-owner")).toEqual(["u-sam", "u-owner"]);
    expect(readAttendees(["u-stranger"], ["u-sam"], "u-owner")).toEqual(["u-owner"]);
    expect(readAttendees([], ["u-sam"], "u-owner")).toEqual(["u-owner"]);
  });
  it("the Others line is names only: no email address, no phone number, 200 characters at most", () => {
    expect(readOthers("  Lee Park,  Ana ")).toEqual({ value: "Lee Park, Ana" });
    expect(readOthers("")).toEqual({ value: null });
    expect(readOthers("Lee lee@example.com")).toMatchObject({ error: "Names only here, no email addresses or phone numbers.", field: "attendeesOther" });
    expect(readOthers("Lee (555) 123-4567")).toMatchObject({ field: "attendeesOther" });
    expect(readOthers("Lee +1 555 123 4567")).toMatchObject({ field: "attendeesOther" });
    expect(readOthers("Lee, the 3rd")).toEqual({ value: "Lee, the 3rd" });
    expect(readOthers("x".repeat(201))).toMatchObject({ error: "Keep the other names to 200 characters." });
  });
  it("the words on a card: who attends (a leaver as a former team member, the owner never), who submitted, and the owner's notice", () => {
    const names: Record<string, string> = { "u-owner": "Maya Chen", "u-sam": "Sam Vale", "u-tess": "Tess Lane" };
    const nameOf = (id: string) => names[id];
    const live = new Set(["u-sam"]);
    expect(attendeeWords({ ...ownersWithTess, attendeesOther: "Lee" }, nameOf, live)).toBe("Attending: Maya Chen, Tess Lane (former team member); others: Lee");
    expect(attendeeWords({ ...samsForOwner, attendeesOther: null }, nameOf, live)).toBe("Attending: Maya Chen, Sam Vale");
    expect(attendeeWords({ ...ownersOwn, attendeesOther: null }, nameOf, new Set())).toBe("Attending: Maya Chen");
    expect(submittedByWords(samsForOwner, nameOf, live)).toBe("Submitted by Sam Vale");
    expect(submittedByWords(samsForOwner, nameOf, new Set())).toBe("Submitted by Sam Vale (former team member)");
    expect(submittedByWords(ownersOwn, nameOf, live)).toBeNull();
    expect(oohNoticeWords("Sam Vale", "Friday, October 23")).toBe("Sam Vale booked office hours for you, Friday, October 23");
  });
});
