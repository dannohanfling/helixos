import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AVATAR_FIELDS, type InterviewTurn } from "@/db/schema";
import { INTERVIEW_QUESTIONS, MAX_FOLLOW_UPS, MAX_TURNS, checkDraft, fieldsToAsk, fieldsToSave, nextTurn, openTurn, transcript } from "@/lib/engine/avatar-interview";
import { allTools, toolsFor } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const turn = (field: InterviewTurn["field"], answer: string | null, followUp = false): InterviewTurn => ({ field, question: INTERVIEW_QUESTIONS[field], answer, followUp });

/** Avatars by interview (rev 636, answered rev 639): the questions, the turn rules, and the server's checks on the draft. */
describe("avatar interview: the questions", () => {
  it("one plain question per field; a new avatar asks all ten, an existing one only its empty fields", () => {
    for (const f of AVATAR_FIELDS) expect(INTERVIEW_QUESTIONS[f]).toMatch(/\?/);
    expect(fieldsToAsk(null)).toEqual([...AVATAR_FIELDS]);
    expect(fieldsToAsk({ who: "Coaches", pains: "  ", wants: null })).toEqual(AVATAR_FIELDS.filter((f) => f !== "who"));
  });

  it("asks the next field, one follow-up per field, at most two in all, never after a skip, and stops at 20", () => {
    const fields = [...AVATAR_FIELDS];
    expect(nextTurn([], fields)).toEqual({ field: "who", question: INTERVIEW_QUESTIONS.who, answer: null, followUp: false });
    // An unanswered question waits; nothing comes next.
    expect(nextTurn([turn("who", null)], fields)).toBeNull();
    expect(openTurn([turn("who", null)])?.field).toBe("who");
    // A thin answer and a follow-up offered: the follow-up, on the same field.
    const t1 = [turn("who", "Coaches")];
    expect(nextTurn(t1, fields, "What kind of coaches?")).toMatchObject({ field: "who", followUp: true, question: "What kind of coaches?" });
    // Never a follow-up to a follow-up, nor to a skipped question.
    expect(nextTurn([...t1, turn("who", "Health coaches", true)], fields, "And then?")).toMatchObject({ field: "pains", followUp: false });
    expect(nextTurn([turn("who", "")], fields, "Why skip?")).toMatchObject({ field: "pains", followUp: false });
    // Two follow-ups in all.
    const two = [turn("who", "a"), turn("who", "b", true), turn("pains", "c"), turn("pains", "d", true), turn("wants", "e")];
    expect(MAX_FOLLOW_UPS).toBe(2);
    expect(nextTurn(two, fields, "More?")).toMatchObject({ field: "tried", followUp: false });
    // Every field asked: done. The hard stop.
    expect(nextTurn(AVATAR_FIELDS.map((f) => turn(f, "x")), fields)).toBeNull();
    expect(MAX_TURNS).toBe(20);
    expect(nextTurn(Array.from({ length: 20 }, () => turn("who", "x")), fields)).toBeNull();
  });

  it("the transcript numbers each answer and leaves skipped ones out", () => {
    const t = transcript([turn("who", "Busy moms"), turn("pains", ""), turn("wants", "Energy back")]);
    expect(t).toContain("A1 (who): Busy moms");
    expect(t).not.toContain("A2");
    expect(t).toContain("A3 (wants): Energy back");
  });
});

describe("avatar interview: the server's checks", () => {
  const turns = [turn("who", "Moms who run a small business"), turn("phrases", "I never get a minute, I'm always behind"), turn("wants", "To make $4,200 a month working 20 hours")];
  it("keeps the words they said, drops a phrase they didn't, a number they didn't give, and a field with no answer behind it", () => {
    const d = checkDraft(
      {
        name: "Busy mom owners",
        fields: {
          who: { text: "Moms who run a small business", from: [1] },
          phrases: { text: "I never get a minute\n“I'm always behind”\nI'm drowning in admin", from: [2] },
          wants: { text: "$4,200 a month\n20 hours a week\nDoubles revenue in 47 days", from: [3] },
          notFor: { text: "Tire kickers", from: [99] },
          pains: { text: "Overwhelm", from: [] },
        },
      },
      turns,
      [...AVATAR_FIELDS],
    );
    expect(d.name).toBe("Busy mom owners");
    expect(d.fields.who).toEqual({ text: "Moms who run a small business", from: [1] });
    expect(d.fields.phrases?.text).toBe("I never get a minute\n“I'm always behind”");
    expect(d.fields.wants?.text).toBe("$4,200 a month\n20 hours a week");
    expect(d.fields.notFor).toBeUndefined();
    expect(d.fields.pains).toBeUndefined();
    expect([...d.dropped].sort()).toEqual(['"Doubles revenue in 47 days" (a number you didn\'t give)', '"I\'m drowning in admin" (you didn\'t say it)', "Not for: no answer behind it", "Top pains or problems: no answer behind it"].sort());
    expect(d.notCovered).toEqual(AVATAR_FIELDS.filter((f) => !["who", "phrases", "wants"].includes(f)));
  });

  it("a draft that isn't JSON-shaped keeps nothing", () => {
    expect(checkDraft(null, turns, [...AVATAR_FIELDS]).fields).toEqual({});
    expect(checkDraft({ fields: { who: { text: 42, from: [1] } } }, turns, [...AVATAR_FIELDS]).fields).toEqual({});
  });

  it("saves only what is kept or edited, and never over a field that is filled", () => {
    const d = { name: "X", fields: { who: { text: "Drafted who", from: [1] }, pains: { text: "Drafted pains", from: [2] }, wants: { text: "Drafted wants", from: [3] } }, dropped: [] };
    expect(fieldsToSave(d, { who: { keep: "keep" }, pains: { keep: "edit", text: "My words" }, wants: { keep: "skip" } }, null)).toEqual({ who: "Drafted who", pains: "My words" });
    expect(fieldsToSave(d, { who: { keep: "keep" }, pains: { keep: "keep" } }, { who: "Filled already", pains: "" })).toEqual({ pains: "Drafted pains" });
    expect(fieldsToSave(d, { who: { keep: "edit", text: "  " } }, null)).toEqual({});
  });
});

describe("avatar interview: the rules", () => {
  it("three tools on the Offers scope, telling Claude never to answer for the member", () => {
    const names = toolsFor(["offers"]).map((t) => t.name);
    for (const n of ["avatar_interview_start", "avatar_interview_answer", "avatar_interview_status"]) expect(names).toContain(n);
    expect(allTools().find((t) => t.name === "avatar_interview_start")!.description).toMatch(/Never answer for them or suggest an answer/);
    expect(allTools().find((t) => t.name === "avatar_interview_status")!.kind).toBe("read");
  });

  it("saving goes through the field checks and the avatars' own save; a switched-in coach is refused", () => {
    const src = read("src/lib/avatar-interview.ts");
    expect(src).toMatch(/const fields = fieldsToSave\(row\.draft, choices, existing \?\? null\);/);
    expect(src).toMatch(/await saveAvatar\(memberOf\(v\)/);
    expect(src).toMatch(/feature: FEATURE, viewer: v, essence: false/);
    const actions = read("src/lib/actions/avatar-interview.ts");
    for (const a of ["startInterviewAction", "answerInterviewAction", "saveInterviewAction", "stopInterviewAction"]) {
      const body = actions.slice(actions.indexOf(`export async function ${a}`), actions.indexOf("\n}\n", actions.indexOf(`export async function ${a}`)));
      expect(body, a).toMatch(/ctx\(\{ whileSwitched: "refuse", reason: THEIRS \}\)/);
    }
  });
});
