import { describe, expect, it } from "vitest";
import { CLARITY_BEATS, LESSONS, LIBRARY_QUESTIONS, OBJECTION_GROUPS, POSTURE_GROUP, PRINCIPLES, REFRAMES, SCRIPT_TYPES, SPOKEN_REFRAMES, assemble, principleNoteText, reframeCopyText, reframesCopyText, beatByStage, hasBuildNote, lessonParagraphs, mentionsReframes, progress, questionsFor, reframesByGroup, scriptText } from "../socrates";

describe("Socrates Domain seed content, as shipped", () => {
  it("has seven lessons in order, Start Here to How-To, under fifteen minutes of reading", () => {
    expect(LESSONS.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(LESSONS[0].section).toBe("Start Here");
    expect(LESSONS[6].section).toBe("How-To");
    const words = LESSONS.reduce((n, l) => n + `${l.body} ${l.whyItMatters} ${l.soundsLike}`.split(/\s+/).length, 0);
    expect(words / 200).toBeLessThan(15);
  });
  it("has 45 questions, every one tagged with a known beat and known script types, with the uneven coverage the brief describes", () => {
    expect(LIBRARY_QUESTIONS).toHaveLength(45);
    for (const q of LIBRARY_QUESTIONS) {
      expect(beatByStage(q.clarityStage), q.id).toBeDefined();
      for (const t of q.scriptTypes) expect(SCRIPT_TYPES as readonly string[], `${q.id} ${t}`).toContain(t);
    }
    const count = (stage: string) => LIBRARY_QUESTIONS.filter((q) => q.clarityStage === stage).length;
    expect(count("A — Areas of Friction")).toBe(10);
    expect(count("T — Tailor the Solution")).toBe(2);
  });
  it("has 11 reframes: nine spoken in the three objection groups, 3 / 3 / 3, and two posture principles apart; ids unique", () => {
    expect(REFRAMES).toHaveLength(11);
    expect(new Set(REFRAMES.map((r) => r.id)).size).toBe(11);
    expect(SPOKEN_REFRAMES.map((r) => r.id)).toEqual(["r01", "r02", "r03", "r04", "r05", "r06", "r07", "r08", "r09"]);
    expect(reframesByGroup().map((g) => [g.group, g.reframes.length])).toEqual(OBJECTION_GROUPS.map((g) => [g, 3]));
    expect(PRINCIPLES.map((r) => [r.id, r.objectionGroup, r.transitionIn])).toEqual([["r10", POSTURE_GROUP, null], ["r11", POSTURE_GROUP, null]]);
    // A principle is never in an objection group, even when the whole file is handed over.
    expect(reframesByGroup(REFRAMES).flatMap((g) => g.reframes.map((r) => r.id))).not.toContain("r11");
    // Every spoken line has a transition in; the data file, not the renderer, owns the words.
    for (const r of SPOKEN_REFRAMES) expect(r.transitionIn, r.id).toBeTruthy();
  });
  it("the spoken lines read like speech, with contractions, and Shoulder to Shoulder carries Hormozi's credit", () => {
    // The words are the data file's, pinned as delivered: the four phrases the fix named, with their contractions.
    const phrase = (id: string) => REFRAMES.find((r) => r.id === id)?.memorablePhrase;
    expect(phrase("r01")).toBe("Don't look only at the repair bill. Look at the leak.");
    expect(phrase("r04")).toBe("This isn't time away from progress. It's time invested so progress gets easier.");
    expect(phrase("r05")).toBe("You don't always need more hours. Sometimes you need a better tool.");
    expect(phrase("r07")).toBe("This usually isn't about rejection. It's about alignment.");
    expect(phrase("r11")).toBe("Guide, don't grapple.");
    expect(REFRAMES.find((r) => r.name === "Shoulder to Shoulder")?.credit).toBe("Alex Hormozi — “shoulder to shoulder”");
    expect(REFRAMES.filter((r) => r.credit)).toHaveLength(1);
  });
  it("copy: one spoken reframe copies clean; several carry group and name as headings; a principle copies only as a note to self, credited; no backslash anywhere", () => {
    const r01 = REFRAMES.find((r) => r.id === "r01")!;
    expect(reframeCopyText(r01)).toBe("Can I show you the way I'd look at that? Don't look only at the repair bill. Look at the leak. If there's a leak in a pipe at your house, you can avoid paying to fix it today — but the leak keeps costing you every day it stays there.");
    expect(reframesCopyText([r01])).toBe(reframeCopyText(r01));
    const r04 = REFRAMES.find((r) => r.id === "r04")!;
    const two = reframesCopyText([r01, r04]);
    expect(two.startsWith("Price / too expensive — Leaky Pipe\n")).toBe(true);
    expect(two).toContain("\n\nNo time / too busy — Sharpening the Axe\n");
    expect(two.endsWith(reframeCopyText(r04))).toBe(true);
    const r11 = REFRAMES.find((r) => r.id === "r11")!;
    expect(principleNoteText(r11)).toBe("Guide, don't grapple.\nSit shoulder to shoulder, on the same side, rather than across from the prospect. The posture changes the psychology.\nThe idea is bigger than physical seating. Handle objections like a guide standing beside the person, not a debater facing them down. The moment it feels like me versus you, resistance rises.\nCredit: Alex Hormozi — “shoulder to shoulder”");
    for (const r of REFRAMES) expect(JSON.stringify(r)).not.toContain("\\\\");
  });
  it("lesson 4 closes on Danno's sentence, no lesson carries a build note, and a build note would still never reach the page", () => {
    const four = LESSONS.find((l) => l.order === 4)!;
    expect(lessonParagraphs(four.body).at(-1)).toBe("Your reframe library is where this layer lives — a metaphor for every objection you will actually hear, grouped by the objection itself rather than as a list to memorise.");
    expect(mentionsReframes(four.body)).toBe(true);
    for (const l of LESSONS) {
      expect(hasBuildNote(l.body), `lesson ${l.order}`).toBe(false);
      expect(lessonParagraphs(l.body).length).toBe(l.body.split(/\n\s*\n/).length);
    }
    expect(lessonParagraphs("Real words.\n\n**Note for the app build:** not for clients.")).toEqual(["Real words."]);
  });
});

describe("the library filter the wizard and the question page share", () => {
  it("shows only the questions tagged for that beat and that script type", () => {
    const dmContext = questionsFor(LIBRARY_QUESTIONS, "C — Context", "DM");
    expect(dmContext.map((q) => q.id)).toEqual(["q22"]);
    expect(questionsFor(LIBRARY_QUESTIONS, "I — Implications", "DM")).toEqual([]);
    expect(questionsFor(LIBRARY_QUESTIONS, "I — Implications", "Follow-Up")).toHaveLength(5);
    expect(questionsFor(LIBRARY_QUESTIONS, null, "Referral").every((q) => q.scriptTypes.includes("Referral"))).toBe(true);
  });
  it("includes a client's own question alongside the library", () => {
    const own = { id: "own1", question: "Mine?", clarityStage: "T — Tailor the Solution", nepqCategory: null, source: "Mine", scriptTypes: ["DM"], own: true };
    expect(questionsFor([...LIBRARY_QUESTIONS, own], "T — Tailor the Solution", "DM").map((q) => q.id)).toEqual(["q13", "own1"]);
  });
});

describe("a script's beats", () => {
  it("counts a beat done with a pick or an override, and the script complete at seven", () => {
    const beats = { C: { questionIds: ["q22"], reframeIds: [], override: null }, L: { questionIds: [], reframeIds: [], override: "My own landscape line." }, A: { questionIds: [], reframeIds: [], override: "   " } };
    expect(progress(beats)).toEqual({ done: 2, total: 7, complete: false });
    const full = Object.fromEntries(CLARITY_BEATS.map((b) => [b.key, { questionIds: [], reframeIds: [], override: `${b.name} words` }]));
    expect(progress(full).complete).toBe(true);
  });
  it("assembles in CLARITY order with picks, reframes and the client's words, and copies out as plain text", () => {
    const beats = { C: { questionIds: ["q22", "q11"], reframeIds: [], override: null }, T: { questionIds: [], reframeIds: ["r01"], override: "Then my bridge." } };
    const a = assemble(beats, LIBRARY_QUESTIONS);
    expect(a.map((x) => x.beat.key)).toEqual(["C", "L", "A", "R", "I", "T", "Y"]);
    expect(a[0].questions.map((q) => q.id)).toEqual(["q11", "q22"]);
    const text = scriptText("Test", "Objection", a);
    expect(text.indexOf("C — Context")).toBeLessThan(text.indexOf("T — Tailor the Solution"));
    expect(text).toContain("Don't look only at the repair bill. Look at the leak.");
    // A principle picked into a script (an older save) is not read out: it was never a line to say.
    expect(assemble({ T: { questionIds: [], reframeIds: ["r11", "r01"], override: null } }, LIBRARY_QUESTIONS).find((x) => x.beat.key === "T")?.reframes.map((r) => r.id)).toEqual(["r01"]);
    expect(text).toContain("Then my bridge.");
    expect(text.indexOf("Look at the leak.")).toBeLessThan(text.indexOf("Then my bridge."));
  });
});
