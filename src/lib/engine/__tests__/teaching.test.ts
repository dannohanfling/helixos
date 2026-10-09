import { describe, expect, it } from "vitest";
import { ftsQuery, hasPrice, libraryBlock, momentOf, originRungs, rank, readFooter, readLibrary, readSource, readStoryBank, searchWords, statusOf, usedIds } from "../teaching";

const LIBRARY = `# Accelerator answers

### Q: How do I fill a room for a workshop?
Start with the people who already said yes once.

Then ask each of them to bring one person.

Topic: Workshops | Category: Seat filling | Taught: 2026-08-14 (Accelerator)

### Q: What do I charge for my first program?
Start at $497 and raise it after three clients.
Topic: Pricing | Category: Offers | Taught: 2026-08-21 (Office Hours)

### Q: A question with no answer
Topic: Nothing | Category: None | Taught: 2026-08-22 (Accelerator)

## Another section
### Q: **What's the hour after?**
**A:** The hour after the room is where the calls get booked.
_Topic: Workshops | Category: Booking | Taught: 2026-09-02 (Business Strategy)_
`;

const STORIES = `# Danno's Story Bank

## 1. The nightclub promoter years
- **Type:** Story
- **What:** Ran the door at a club for five years and learned
  that the list is the business.
- **Exact words:** "The list is the business."
- **Numbers:** 400 names a night
- **Good for:** Origin Story, Method Resource
- **Publish status:** Danno's own, ok to use
- **Source:** Accelerator call, 2026-08-14, https://fathom.video/share/abc?timestamp=724

## 2. A client's first five calls
- **Type:** Client result
- **What:** A coach booked five calls in a week from one post.
- **Publish status:** Needs client permission (name withheld)
- **Source:** Office Hours, 2026-09-02, https://fathom.video/share/def?timestamp=60

## 3. The ten-thousand-dollar month
- **Type:** Number
- **What:** A $10,000 month from one workshop.
- **Publish status:** Check before using (figure said loosely / unclear)

## 4. No type here
- **What:** Something with no type.

Type: Analogy
What: A workshop is a first date, not a proposal.
Good for: Contrarian Belief
Publish status: Danno's own, ok to use
Source: Community Building, 2026-09-10
`;

describe("Danno's teaching library and story bank (rev 615, answered at rev 618)", () => {
  it("reads the library's ### Q: entries with their footers, counts what it can't read, and marks a price", () => {
    const r = readLibrary(LIBRARY);
    expect(r.entries.map((e) => e.question)).toEqual(["How do I fill a room for a workshop?", "What do I charge for my first program?", "What's the hour after?"]);
    expect(r.unreadable).toEqual(["A question with no answer"]);
    const first = r.entries[0];
    expect(first.answer).toBe("Start with the people who already said yes once.\n\nThen ask each of them to bring one person.");
    expect([first.topic, first.category, first.taughtOn, first.callType]).toEqual(["Workshops", "Seat filling", "2026-08-14", "Accelerator"]);
    expect(r.entries[1].hasPrice).toBe(true);
    expect(r.entries[2].answer).toBe("The hour after the room is where the calls get booked.");
    expect(r.entries[2].callType).toBe("Business Strategy");
    // Re-reading the same text gives the same keys: a re-upload updates, never doubles.
    expect(readLibrary(LIBRARY).entries.map((e) => e.key)).toEqual(r.entries.map((e) => e.key));
    expect(readFooter("Topic: A | Category: B | Taught: 2026-01-02 (Office Hours)")).toEqual({ topic: "A", category: "B", taughtOn: "2026-01-02", callType: "Office Hours" });
    expect(readFooter("Not a footer")).toBeNull();
  });
  it("reads the story bank: the fields under each heading or from a Type line, the three statuses, the Fathom link and its moment", () => {
    const r = readStoryBank(STORIES);
    expect(r.entries.map((e) => [e.type, e.status])).toEqual([["story", "ready"], ["client_result", "needs_permission"], ["number", "check"], ["analogy", "ready"]]);
    expect(r.unreadable).toEqual(["No type here"]);
    const club = r.entries[0];
    expect(club.title).toBe("The nightclub promoter years");
    expect(club.what).toBe("Ran the door at a club for five years and learned\nthat the list is the business.");
    expect(club.exactWords).toBe('"The list is the business."');
    expect([club.sourceCall, club.sourceDate, club.fathomUrl]).toEqual(["Accelerator call", "2026-08-14", "https://fathom.video/share/abc?timestamp=724"]);
    expect(momentOf(club.fathomUrl)).toBe("12:04");
    expect(r.entries[2].hasPrice).toBe(true);
    expect(r.entries[3].title).toBe("A workshop is a first date, not a proposal");
    expect(r.entries[3].fathomUrl).toBeNull();
    expect(readSource("Office Hours, 2026-09-02")).toEqual({ sourceCall: "Office Hours", sourceDate: "2026-09-02", fathomUrl: null });
  });
  it("maps the status words, and anything unknown is check, never ready by accident", () => {
    expect([statusOf("Danno's own, ok to use"), statusOf("Needs client permission (name withheld)"), statusOf("Check before using (figure said loosely / unclear)"), statusOf("maybe"), statusOf(null)]).toEqual(["ready", "needs_permission", "check", "check", "check"]);
  });
  it("finds prices of any kind and leaves plain numbers alone", () => {
    expect(hasPrice("Start at $497")).toBe(true);
    expect(hasPrice("a 5k/month client")).toBe(true);
    expect(hasPrice("2000 dollars")).toBe(true);
    expect(hasPrice("100 leads with zero ad spend")).toBe(false);
    expect(hasPrice("five calls in a week")).toBe(false);
  });
  it("searches by the ladder's own words, quoted, and ranks fresh before used, a format's Good for first", () => {
    const w = searchWords({ topic: "How to turn a full room into booked calls", formatName: "Method Resource", target: "the workshop checklist", source: null });
    expect(w).toEqual(["turn", "full", "room", "booked", "calls", "method", "resource", "workshop", "checklist"]);
    expect(ftsQuery(["room", 'he"llo'])).toBe('"room" OR "hello"');
    const items = [{ key: "a", goodFor: null }, { key: "b", goodFor: "Method Resource" }, { key: "c", goodFor: null }];
    const ranked = rank([{ item: items[0], score: 10 }, { item: items[1], score: 8 }, { item: items[2], score: 9 }], { formatName: "Method Resource", usedRecently: new Set(["a"]), take: 2 });
    expect(ranked.map((x) => x.key)).toEqual(["b", "c"]);
  });
  it("gives the writer short ids and reads back the ones it used", () => {
    const block = libraryBlock([{ question: "Q1?", answer: "A1." }], [{ type: "client_result", title: "Five calls", what: "Booked five.", exactWords: null, numbers: "5" }]);
    expect(block).toContain("[T1] Q: Q1?");
    expect(block).toContain("[S1] (client result) Five calls");
    expect(libraryBlock([], [])).toBe("");
    expect(usedIds("T2, S1, t2 and X9")).toEqual(["T2", "S1"]);
  });
  it("finds the rungs that retell the origin story", () => {
    const origin = "Five years running the door at a nightclub taught me promoter math and guestlist discipline.";
    const rungs = ["I ran the nightclub door as a promoter, guestlist in hand, discipline first.", "Here's the checklist.", "Back at the nightclub, the promoter guestlist discipline was everything."];
    expect(originRungs(origin, rungs)).toEqual([0, 2]);
    expect(originRungs("", rungs)).toEqual([]);
    // Everyday words are not a retelling: a Tuesday, some minutes and a friend in both are only a coincidence.
    const everyday = "Every Tuesday for ten minutes I already called one friend from the nightclub about promoter work.";
    expect(originRungs(everyday, ["On Tuesday it took minutes; I already told a friend.", "Ten minutes, already done, Tuesday again, ask a friend."])).toEqual([]);
  });
});
