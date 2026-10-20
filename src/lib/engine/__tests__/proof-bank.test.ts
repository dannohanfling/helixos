import { describe, expect, it } from "vitest";
import { BATCH_UNDO_HOURS, PROOF_PAGE, canUndo, inView, matchList, pageOf, readListFile, viewCounts, viewOf } from "@/lib/engine/proof-bank";

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

  it("the list file is read for its clean rows only, and refused when it isn't one", () => {
    expect(readListFile("nope")).toEqual({ error: "That isn't a JSON file." });
    expect(readListFile("{}")).toEqual({ error: 'The file has no "approve_clean" list.' });
    expect(readListFile('{"approve_clean": []}')).toEqual({ error: 'The "approve_clean" list is empty.' });
    const r = readListFile(JSON.stringify({ approve_clean: [{ who: " Maya C. ", date: "2026-10-20T00:00", result_starts: '"I  doubled  it"' }], keep_as_draft: [{ who: "X", why: "unclear" }] }));
    expect(r).toEqual({ entries: [{ who: "maya c.", date: "2026-10-20", result: '"i doubled it"' }] });
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
