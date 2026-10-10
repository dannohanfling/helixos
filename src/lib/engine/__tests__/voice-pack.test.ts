import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools, toolsFor } from "@/lib/mcp/registry";
import { SCOPE_WORDS, OPT_IN_SCOPES } from "@/lib/engine/mcp";
import { contentTypeFrom, dayFrom, findByName, fridayFrom, fridayWords, oohReadBack, pickCall, proofFrom, quickSheet, stageFrom } from "@/lib/engine/voice-pack";
import type { CallSheet } from "@/lib/engine/socrates";
import "@/lib/mcp/tools";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Voice pack 2 (rev 642): the pure parts, which scope lists which tool, and the rules the tools must keep. */
describe("Voice pack 2: finding by what was said", () => {
  const people = [{ name: "Sarah Lee" }, { name: "Sarah Kim" }, { name: "Tom Ford" }, { name: "Tomas Ruiz" }];
  it("one, several, none; an exact name wins; never a guess between two", () => {
    expect(findByName(people, "Tom Ford")).toEqual({ one: { name: "Tom Ford" } });
    expect(findByName(people, "sarah lee")).toEqual({ one: { name: "Sarah Lee" } });
    expect(findByName(people, "Sarah")).toEqual({ several: [{ name: "Sarah Lee" }, { name: "Sarah Kim" }] });
    expect(findByName(people, "Tom")).toEqual({ several: [{ name: "Tom Ford" }, { name: "Tomas Ruiz" }] });
    expect(findByName(people, "Ruiz")).toEqual({ one: { name: "Tomas Ruiz" } });
    expect(findByName(people, "Jen")).toEqual({ none: true });
    expect(findByName(people, "  ")).toEqual({ none: true });
    expect(findByName([{ name: "Sam Day" }, { name: "Sam Day" }], "Sam Day")).toEqual({ several: [{ name: "Sam Day" }, { name: "Sam Day" }] });
  });

  it("stages in the DMs page's words; days as said", () => {
    expect(stageFrom("In conversation")).toBe("conversation");
    expect(stageFrom("Reached out")).toBe("new");
    expect(stageFrom("call booked")).toBe("call_booked");
    expect(stageFrom("call_booked")).toBe("call_booked");
    expect(stageFrom("maybe")).toBeNull();
    // 2026-10-10 is a Saturday.
    expect(dayFrom("Thursday", "2026-10-10")).toBe("2026-10-15");
    expect(dayFrom("saturday", "2026-10-10")).toBe("2026-10-17");
    expect(dayFrom("tomorrow", "2026-10-10")).toBe("2026-10-11");
    expect(dayFrom("in 3 days", "2026-10-10")).toBe("2026-10-13");
    expect(dayFrom("2026-11-02", "2026-10-10")).toBe("2026-11-02");
    expect(dayFrom("whenever", "2026-10-10")).toBeNull();
  });

  it("a Friday from the next four, by date, by day of the month, or the next one", () => {
    const fridays = ["2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"];
    expect(fridayFrom(undefined, fridays)).toBe("2026-10-16");
    expect(fridayFrom("the 23rd", fridays)).toBe("2026-10-23");
    expect(fridayFrom("2026-11-06", fridays)).toBe("2026-11-06");
    expect(fridayFrom("2026-11-13", fridays)).toBeNull();
    expect(fridayFrom("the 20th", fridays)).toBeNull();
    expect(fridayWords("2026-10-23")).toBe("Friday the 23rd");
    expect(fridayWords("2026-10-11")).toBe("Friday the 11th");
  });
});

describe("Voice pack 2: what is saved", () => {
  it("a proof keeps the member's words and numbers exactly; the date and source are tags", () => {
    const p = proofFrom({ who: "Jen", result: "Booked 6 calls from one post", numbers: "$4,200 in 3 weeks", date: "2026-10-08", source: "Call" });
    expect(p.resultAfter).toBe("Booked 6 calls from one post ($4,200 in 3 weeks)");
    expect(p.tags).toEqual(["2026-10-08", "call"]);
    expect(p.who).toBe("Jen");
    expect(proofFrom({ result: "Went from $1,250.50 to $9,875.25 a month", numbers: "$9,875.25" }).resultAfter).toBe("Went from $1,250.50 to $9,875.25 a month");
    expect(proofFrom({ result: "Signed 3 clients" }).who).toBeNull();
  });

  it("the permission tick needs client_agreed and a name, and a proof is never approved here", () => {
    const src = read("src/lib/mcp/tools/voice2.ts");
    expect(src).toMatch(/const agreed = input\.client_agreed === true && Boolean\(p\.who\);/);
    expect(src).toMatch(/\{ permission: agreed \}/);
    expect(src).not.toMatch(/status: "approved"/);
    // createProof always saves a draft; permission only with a who.
    const core = read("src/lib/proofs-core.ts");
    expect(core).toMatch(/const ticked = opts\.permission && Boolean\(f\.who\);/);
    expect(core).toMatch(/status: "draft"/);
  });

  it("format hints map to the board's content types", () => {
    expect(contentTypeFrom("a comment ladder")).toBe("Comment Ladder");
    expect(contentTypeFrom("story")).toBe("Story Post");
    expect(contentTypeFrom("reel")).toBe("Short Form Video");
    expect(contentTypeFrom("Client Win")).toBe("Client Win");
    expect(contentTypeFrom(undefined)).toBe("CTA Post");
  });

  it("the 30-second sheet: the first line of five beats, three listen-fors", () => {
    const beat = (n: number, listen: string | null) => ({ n, name: `Beat ${n}`, you: [`Line ${n}\nmore`], followUps: [], reframes: [], listenFor: listen, branches: [] });
    const sheet: CallSheet = { title: "S", subtitle: "", beats: [1, 2, 3, 4, 5, 6, 7].map((n) => beat(n, n % 2 ? `Listen ${n}` : null)) };
    const q = quickSheet(sheet);
    expect(q.lines).toEqual(["Beat 1: Line 1", "Beat 2: Line 2", "Beat 3: Line 3", "Beat 4: Line 4", "Beat 5: Line 5"]);
    expect(q.listenFors).toEqual(["Listen 1", "Listen 3", "Listen 5"]);
  });

  it("the Office Hours read-back ends with being there on the Friday", () => {
    const t = oohReadBack({ question: "My bot loops", tried: "Rebuilt the flow", outcome: "A working flow", category: "Chatbot", friday: "2026-10-16" });
    expect(t).toMatch(/you'll be there on Friday the 16th\. Shall I send it\?$/);
  });

  it("a call by latest, date or title words", () => {
    const rows = [
      { title: "Accelerator", clearTitle: "Evolve Omega Accelerator · Mon 9 AM", startedAt: "2026-10-05T16:00:00Z", createdAt: "x" },
      { title: "Hot seat", clearTitle: null, startedAt: "2026-10-08T16:00:00Z", createdAt: "x" },
    ];
    const day = (iso: string) => iso.slice(0, 10);
    expect(pickCall(rows, undefined, day)?.title).toBe("Hot seat");
    expect(pickCall(rows, "latest", day)?.title).toBe("Hot seat");
    expect(pickCall(rows, "2026-10-05", day)?.title).toBe("Accelerator");
    expect(pickCall(rows, "the accelerator call", day)?.title).toBe("Accelerator");
    expect(pickCall(rows, "2026-10-01", day)).toBeNull();
  });
});

describe("Voice pack 2: scopes and rules", () => {
  const names = (scopes: Parameters<typeof toolsFor>[0]) => toolsFor(scopes).map((t) => t.name);
  it("each area is its own tick, with its own line; none is opt-in", () => {
    expect(names(["dms"]).sort()).toEqual(["dm_log", "dms_list", "whoami"]);
    expect(names(["proofs"]).sort()).toEqual(["proof_add", "proof_list", "whoami"]);
    expect(names(["sales"]).sort()).toEqual(["callsheet_read", "whoami"]);
    expect(names(["recordings"]).sort()).toEqual(["action_step_to_task", "action_steps_read", "whoami"]);
    expect(names(["office_hours"]).sort()).toEqual(["office_hours_list", "office_hours_submit", "whoami"]);
    expect(names(["content"])).toContain("ideas_list");
    expect(names(["content"])).not.toContain("idea_add");
    expect(names(["content:write"])).toContain("idea_add");
    for (const s of ["dms", "proofs", "sales", "recordings", "office_hours"] as const) {
      expect(SCOPE_WORDS[s].line.length).toBeGreaterThan(20);
      expect(OPT_IN_SCOPES).not.toContain(s);
    }
  });

  it("refuses a team member where the app does, before anything is read; DMs and ideas stay open", async () => {
    const team = { team: { teamMemberId: "tm", ownerName: "Maya" }, user: { id: "u" }, workspace: { id: "w", oohCategories: [] }, today: "2026-10-10" } as never;
    for (const n of ["proof_add", "proof_list", "callsheet_read", "action_steps_read", "action_step_to_task", "office_hours_submit", "office_hours_list"]) {
      await expect(allTools().find((t) => t.name === n)!.handler(team, { result: "x x x", step: 1, question: "q q q", tried: "t t t", outcome: "o o o" }), n).rejects.toThrow(/team member can't/);
    }
    const src = read("src/lib/mcp/tools/voice2.ts");
    for (const n of ["dm_log", "dms_list", "idea_add", "ideas_list"]) {
      const body = src.slice(src.indexOf(`name: "${n}"`), src.indexOf("defineTool(", src.indexOf(`name: "${n}"`)));
      expect(body, n).not.toMatch(/ownerOnly/);
    }
  });

  it("Office Hours is sent only with confirm, through the page's own save; the yes is the promise", () => {
    const src = read("src/lib/mcp/tools/voice2.ts");
    const submit = src.slice(src.indexOf('name: "office_hours_submit"'), src.indexOf('name: "office_hours_list"'));
    expect(submit.indexOf("input.confirm !== true")).toBeGreaterThan(0);
    expect(submit.indexOf("input.confirm !== true")).toBeLessThan(submit.indexOf("saveOohRequest("));
    expect(submit).toMatch(/triedGate: "yes", promise: true/);
    expect(read("src/lib/actions/office-hours.ts")).toMatch(/await saveOohRequest\(/);
  });

  it("one writer: the pages and the tools call the same functions", () => {
    expect(read("src/lib/actions/contacts.ts")).toMatch(/await createContact\(/);
    expect(read("src/lib/actions/contacts.ts")).toMatch(/await logMessage\(/);
    expect(read("src/lib/actions/contacts.ts")).toMatch(/await updateContact\(/);
    expect(read("src/lib/actions/proofs.ts")).toMatch(/createProof\(/);
    expect(read("src/lib/actions/content.ts")).toMatch(/createContentItem\(/);
    expect(read("src/lib/actions/recordings.ts")).toMatch(/addStepTask\(/);
    // The own-or-everyone rule lives in the shared function, not only on the page.
    expect(read("src/lib/recordings.ts")).toMatch(/if \(!group \|\| !\(group\.own \|\| group\.everyone\)\) return \{ ok: false/);
  });
});
