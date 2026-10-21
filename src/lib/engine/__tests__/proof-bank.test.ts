import { describe, expect, it } from "vitest";
import { BATCH_UNDO_HOURS, PROOF_PAGE, applyCorrection, canUndo, inView, matchList, pageOf, parseCorrections, readListFile, restoreFields, viewCounts, viewOf } from "@/lib/engine/proof-bank";

describe("the Proof Bank list (H-1393, H-1394)", () => {
  it("a proof is a draft, a draft with its permission recorded, or approved; the counts see the whole bank", () => {
    const rows = [
      { status: "draft", permissionAt: null },
      { status: "draft", permissionAt: "2026-10-20T10:00:00.000Z" },
      { status: "approved", permissionAt: "2026-10-20T10:00:00.000Z" },
      { status: "approved", permissionAt: null },
    ];
    expect(rows.map(viewOf)).toEqual(["draft", "permission", "approved", "approved"]);
    expect(viewCounts(rows)).toEqual({ all: 4, draft: 1, permission: 1, approved: 2 });
    expect(inView(rows[0], "all")).toBe(true);
    expect(inView(rows[0], "approved")).toBe(false);
  });

  it("the page shows whole pages of 250 and says how many more there are", () => {
    const rows = Array.from({ length: 620 }, (_, i) => i);
    expect(pageOf(rows, undefined)).toMatchObject({ shown: 250, more: 370 });
    expect(pageOf(rows, 500)).toMatchObject({ shown: 500, more: 120 });
    expect(pageOf(rows, 501)).toMatchObject({ shown: 620, more: 0 });
    expect(pageOf(rows, 10).rows).toHaveLength(PROOF_PAGE);
  });

  it("the list file is read for its clean and transcript-checked rows only, and refused when it isn't one", () => {
    expect(readListFile("nope")).toEqual({ error: "That isn't a JSON file." });
    expect(readListFile("{}")).toEqual({ error: 'The file has no "approve_clean" list.' });
    expect(readListFile('{"approve_clean": []}')).toEqual({ error: "The lists in the file are empty." });
    const r = readListFile(JSON.stringify({ approve_clean: [{ who: " Maya C. ", date: "2026-10-20T00:00", result_starts: '"I  doubled  it"' }], keep_as_draft: [{ who: "X", why: "unclear" }] }));
    expect(r).toEqual({ entries: [{ who: "maya c.", date: "2026-10-20", result: '"i doubled it"', correctWho: null, correctedQuote: null }] });
    // The transcript-checked rows come first with their corrections (H-1414); a draft in both lists takes those (H-1415).
    const both = readListFile(
      JSON.stringify({
        approve_clean: [
          { who: "Leo K.", date: "2026-10-20", result_starts: '"Booked three calls' },
          { who: "Ann P.", date: "2026-10-20", result_starts: '"Doubled the list' },
        ],
        approve_after_transcript_check: [{ who: "Leo K.", date: "2026-10-20", result_starts: '"Booked three calls', correct_who: "Leo Kay", corrected_quote: '"Booked  four calls"' }, { who: "Zed", date: "2026-10-20", result_starts: "", correct_who: null, corrected_quote: null }],
      }),
    );
    expect(both).toEqual({
      entries: [
        { who: "leo k.", date: "2026-10-20", result: '"booked three calls', correctWho: "Leo Kay", correctedQuote: '"Booked four calls"' },
        { who: "ann p.", date: "2026-10-20", result: '"doubled the list', correctWho: null, correctedQuote: null },
      ],
    });
  });

  it("a matched entry's corrections come back for the draft, only where they differ; the confirm step's corrections are read back bounded", () => {
    const rows = [
      { id: "a", who: "Leo K.", resultAfter: null, quote: '"Booked three calls this week"', shortVersion: null, sourceRecordedAt: "2026-10-20", createdAt: "2026-10-21 09:00:00" },
      { id: "b", who: "Ann P.", resultAfter: '"Doubled the list"', quote: null, shortVersion: null, sourceRecordedAt: "2026-10-20", createdAt: "2026-10-21 09:00:00" },
    ];
    const m = matchList(rows, [
      { who: "leo k.", date: "2026-10-20", result: '"booked three calls', correctWho: "Leo Kay", correctedQuote: '"Booked four calls this week"' },
      { who: "ann p.", date: "2026-10-20", result: '"doubled the list', correctWho: "Ann P.", correctedQuote: '"doubled the list"' },
    ]);
    expect(m.ids.sort()).toEqual(["a", "b"]);
    expect(m.corrections).toEqual([{ id: "a", who: "Leo Kay", quote: '"Booked four calls this week"' }]);
    const allowed = new Set(["a", "b"]);
    expect(parseCorrections(JSON.stringify(m.corrections), allowed)).toEqual(m.corrections);
    expect(parseCorrections(JSON.stringify([{ id: "zz", who: "X", quote: null }, { id: "b", who: null, quote: null }, { id: "a", who: "  Leo   Kay ", quote: "x".repeat(6000) }, { id: "a", who: "again" }]), allowed)).toEqual([{ id: "a", who: "Leo Kay", quote: "x".repeat(5000) }]);
    expect(parseCorrections("nope", allowed)).toEqual([]);
    expect(parseCorrections(null, allowed)).toEqual([]);
  });

  it("a correction changes the quote where the draft keeps it, the shapes that were trims of it, a built name, and who; Undo gets the old fields back", () => {
    const quote = '"I doubled my list this month and then some, honestly, after the rewrite landed"';
    const harvested = { name: "Leo K.: \"I doubled my list this month and then some,…", who: "Leo K.", quote, resultAfter: null, longVersion: quote, shortVersion: quote };
    const fixed = '"I tripled my list this month and then some, after the rewrite landed"';
    const h = applyCorrection(harvested, { who: "Leo Kay", quote: fixed })!;
    expect(h.set).toEqual({ who: "Leo Kay", quote: fixed, longVersion: fixed, shortVersion: fixed });
    // The name was not built from the quote (it lacks the ellipsis the harvest adds), so it stays; a built one follows the new words.
    const built = { ...harvested, name: 'Leo K.: "I doubled my list this month and then…' };
    expect(applyCorrection(built, { who: "Leo Kay", quote: fixed })!.set.name).toBe('Leo K.: "I tripled my list this month and then…');
    // The same first words and a name that shortens the same way: the name stays as it is.
    expect(applyCorrection(built, { who: "Leo Kay", quote: '"I doubled my list this month and then some, after" rewrite' })!.set).not.toHaveProperty("name");
    expect(h.before).toEqual({ who: "Leo K.", quote, longVersion: quote, shortVersion: quote });
    const typed = { name: "Smoke bank quote", who: "Ann P.", quote: null, resultAfter: '"Doubled the list"', longVersion: null, shortVersion: "something else" };
    expect(applyCorrection(typed, { who: null, quote: '"Doubled the list twice"' })).toEqual({ set: { resultAfter: '"Doubled the list twice"' }, before: { resultAfter: '"Doubled the list"' } });
    expect(applyCorrection(typed, { who: "Ann P.", quote: '"Doubled the list"' })).toBeNull();
    expect(restoreFields({ who: "Leo K.", quote: null, name: null, nope: "x", resultAfter: 3 })).toEqual({ who: "Leo K.", quote: null });
    expect(restoreFields("junk")).toEqual({});
  });

  it("matches by who, date and the first 120 characters of the result in any of the three fields; one draft per entry; the rest counted", () => {
    const rows = [
      { id: "a", who: "Maya C.", resultAfter: '"I doubled it this month and then some"', quote: null, shortVersion: null, sourceRecordedAt: "2026-10-20", createdAt: "2026-10-21 09:00:00" },
      { id: "b", who: "Maya C.", resultAfter: null, quote: '"I doubled it this month and then some"', shortVersion: null, sourceRecordedAt: null, createdAt: "2026-10-21 09:00:00" },
      { id: "c", who: "Leo K.", resultAfter: '"Booked three calls"', quote: null, shortVersion: null, sourceRecordedAt: "2026-10-20", createdAt: "2026-10-21 09:00:00" },
    ];
    const entries = [
      { who: "maya c.", date: "2026-10-20", result: '"i doubled it this month' },
      { who: "maya c.", date: "2026-10-21", result: '"i doubled it' },
      { who: "leo k.", date: "2026-10-20", result: '"booked four calls' },
      { who: "nobody", date: "", result: "x" },
    ];
    const m = matchList(rows, entries);
    expect(m.ids.sort()).toEqual(["a", "b"]);
    expect(m.matched).toBe(2);
    expect(m.notFound).toBe(2);
    expect(m.corrections).toEqual([]);
  });

  it("a batch can be undone within 24 hours, once", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(canUndo({ approvedAt: "2026-10-21 11:00:00", undoneAt: null }, now)).toBe(true);
    expect(canUndo({ approvedAt: "2026-10-21T11:00:00.000Z", undoneAt: "2026-10-21T11:30:00.000Z" }, now)).toBe(false);
    expect(canUndo({ approvedAt: `2026-10-20 ${12 - 1}:00:00`, undoneAt: null }, now)).toBe(false);
    expect(canUndo(null, now)).toBe(false);
    expect(BATCH_UNDO_HOURS).toBe(24);
  });
});
