import { describe, expect, it } from "vitest";
import { PROOF_IMPORT, PROOF_TAGS_FIRST, importSummary, mapTestimonial, scrubContacts, shortName, tagRank } from "../proof-import";

/** Danno's Proof Bank from Airtable (8 Oct): what a clip becomes, what never gets in, and the order the bank shows them in. */
describe("Proof Bank import from Airtable", () => {
  const F = PROOF_IMPORT.fields;
  const names = new Map([["recA", "Marisol Quintero"], ["recB", "tomas.ferreira@example.com"]]);
  it("names are first name and last initial, from a name or an email", () => {
    expect(shortName("Marisol Quintero")).toBe("Marisol Q.");
    expect(shortName("tomas.ferreira@example.com")).toBe("Tomas F.");
    expect(shortName("  jane ")).toBe("Jane");
    expect(shortName("")).toBe("");
  });
  it("an email or a phone number in the quote is blanked; an ordinary number stays", () => {
    expect(scrubContacts("Email me at marisol@example.com or call 555 010 0123, I made 3 sales.")).toBe("Email me at [email removed] or call [number removed], I made 3 sales.");
    expect(scrubContacts("Revenue doubled since June, 12 clients now.")).toBe("Revenue doubled since June, 12 clients now.");
  });
  it("a row becomes an approved-shaped proof with its source and tags; one with no quote becomes nothing", () => {
    const p = mapTestimonial({ id: "rec1", fields: { [F.quote]: "I closed three clients this week.", [F.client]: ["recA"], [F.title]: "Weekly call", [F.date]: "2026-08-14", [F.timestamp]: 754, [F.link]: "https://fathom.video/share/x", [F.categories]: ["Sales Wins", "Sales Wins", "Mindset"] } }, names)!;
    expect(p).toMatchObject({ airtableId: "rec1", who: "Marisol Q.", quote: "I closed three clients this week.", sourceTitle: "Weekly call", sourceRecordedAt: "2026-08-14T12:00:00.000Z", sourceTimestamp: "12:34", sourceUrl: "https://fathom.video/share/x", tags: ["Sales Wins", "Mindset"] });
    expect(p.name).toBe("Marisol Q.: I closed three clients this week.");
    expect(mapTestimonial({ id: "rec2", fields: { [F.client]: ["recA"] } }, names)).toBeNull();
    expect(mapTestimonial({ id: "rec3", fields: { [F.quote]: "Good call." } }, names)!.who).toBe("A client");
  });
  it("Results & Revenue, Sales Wins and Transformation come first, in that order", () => {
    expect(PROOF_TAGS_FIRST).toEqual(["Results & Revenue", "Sales Wins", "Transformation"]);
    expect([tagRank(["Mindset"]), tagRank(["Transformation"]), tagRank(["Mindset", "Sales Wins"]), tagRank(["Results & Revenue"]), tagRank([])]).toEqual([3, 2, 1, 0, 3]);
    expect(importSummary(12, 3591, 2)).toBe("Added 12, skipped 3,591 already in, left out 2 with no quote.");
  });
});
