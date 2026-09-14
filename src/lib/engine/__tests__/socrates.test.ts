import { describe, expect, it } from "vitest";
import { BRANCH_CONDITIONS, CLARITY_BEATS, LESSONS, LIBRARY_QUESTIONS, MAX_FOLLOW_UPS, OBJECTION_GROUPS, POSTURE_GROUP, PRINCIPLES, REFRAMES, SCRIPT_TYPES, SPOKEN_REFRAMES, assemble, branchesFor, callSheet, callSheetHtml, callSheetText, copyBlockText, defaultBranchIds, fillText, noBrackets, placeholdersIn, placeholdersOf, principleNoteText, reframeCopyText, reframesCopyText, unfilledIn, unfilledMark, beatByStage, hasBuildNote, lessonParagraphs, mentionsReframes, progress, questionsFor, reframesByGroup, scriptText } from "../socrates";

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
    // Pick order is meaning: the first is the question, the rest are its follow-ups.
    expect(a[0].questions.map((q) => q.id)).toEqual(["q22", "q11"]);
    const text = scriptText("Test", "Objection", a);
    expect(text.indexOf("C — Context")).toBeLessThan(text.indexOf("T — Tailor the Solution"));
    expect(text).toContain("Don't look only at the repair bill. Look at the leak.");
    // A principle picked into a script (an older save) is not read out: it was never a line to say.
    expect(assemble({ T: { questionIds: [], reframeIds: ["r11", "r01"], override: null } }, LIBRARY_QUESTIONS).find((x) => x.beat.key === "T")?.reframes.map((r) => r.id)).toEqual(["r01"]);
    expect(text).toContain("Then my bridge.");
    expect(text.indexOf("Look at the leak.")).toBeLessThan(text.indexOf("Then my bridge."));
  });
});

describe("the call sheet: blanks filled once, two sides, three outputs, and never the prospect's lines", () => {
  const q = (id: string) => LIBRARY_QUESTIONS.find((x) => x.id === id)!;
  const beats = {
    C: { questionIds: ["q25"], reframeIds: [], override: null, listenFor: "Whether it resolved, stalled or got worse." },
    L: { questionIds: ["q26"], reframeIds: [], override: null },
    A: { questionIds: ["q09", "q34"], reframeIds: [], override: null },
    T: { questionIds: ["q13"], reframeIds: [], override: null },
    Y: { questionIds: ["q41"], reframeIds: [], override: "My own closing words.", branchIds: ["r07", "r11"] },
  };
  const assembled = assemble(beats, LIBRARY_QUESTIONS);
  it("every blank is asked once, in the order it is met: [X] in two questions is one blank", () => {
    expect(placeholdersOf(assembled)).toEqual(["X", "the surface thing", "their pain phrase", "3 pillars"]);
    expect(q("q25").question).toContain("[X]");
    expect(q("q26").question).toContain("[X]");
  });
  it("a fill replaces the blank everywhere; an empty one is shown unfilled, and the output carries no square brackets", () => {
    const fills = { X: "the hiring freeze", "3 pillars": "Reset, Rhythm, Results" };
    expect(fillText(q("q25").question, fills)).toBe("Last time we spoke you mentioned the hiring freeze — where did that land?");
    expect(fillText(q("q26").question, fills)).toBe("Walk me through how you're handling the hiring freeze right now.");
    expect(fillText(q("q13").question, fills)).toBe(`Based on what you said about ${unfilledMark("their pain phrase")}, what we do is Reset, Rhythm, Results. Does that sound like it could fit?`);
    expect(unfilledIn(assembled, fills)).toEqual(["the surface thing", "their pain phrase"]);
    const sheet = callSheet("Sarah Chen", "Follow-Up", assembled, fills);
    for (const out of [callSheetText(sheet), copyBlockText(sheet), callSheetHtml(sheet)]) expect(out).not.toMatch(/[[\]]/);
  });
  it("no square bracket reaches an output from anything typed: stray, nested or empty brackets and brackets in a fill become parentheses; listen-for is filled too", () => {
    expect(placeholdersIn("Call me [] now, or [ ]")).toEqual([]);
    expect(fillText("Call me [] now", {})).toBe("Call me () now");
    expect(fillText("Say [[X]] now", { X: "v" })).toBe("Say (v) now");
    expect(fillText("Say [X now", {})).toBe("Say (X now");
    expect(fillText("Say [X] now", { X: "[Y]" })).toBe("Say (Y) now");
    expect(noBrackets("a [b] c")).toBe("a (b) c");
    const withNote = assemble({ C: { questionIds: ["q25"], reframeIds: [], override: null, listenFor: "Whether [X] is still live." } }, LIBRARY_QUESTIONS);
    expect(placeholdersOf(withNote)).toEqual(["X"]);
    expect(callSheet("n", "DM", withNote, { X: "the freeze" }).beats[0].listenFor).toBe("Whether the freeze is still live.");
  });
  it("an Objection script's own reframe at Tailor is its own block, spoken as written: not a follow-up, not in the copy block, not filled, and not doubled as a branch", () => {
    const a = assemble({ T: { questionIds: ["q13"], reframeIds: ["r01"], override: null } }, LIBRARY_QUESTIONS);
    const sheet = callSheet("n", "Objection", a, { "their pain phrase": "x", "3 pillars": "y" });
    const T = sheet.beats[5];
    expect(T.followUps).toEqual([]);
    expect(T.reframes).toEqual([{ said: reframeCopyText(REFRAMES.find((r) => r.id === "r01")!), name: "Leaky Pipe" }]);
    expect(T.branches.flatMap((b) => b.lines.map((l) => l.name))).toEqual(["Sharpening the Axe", "Getting in the Same Car"]);
    expect(copyBlockText(sheet)).not.toContain("repair bill");
    expect(callSheetText(sheet)).toContain("  Reframe\n  \"Can I show you the way I'd look at that?");
  });
  it("follow-ups are the picks after the first, capped; the question is the YOU line and the client's own words follow", () => {
    expect(MAX_FOLLOW_UPS).toBe(2);
    const sheet = callSheet("Sarah Chen", "Follow-Up", assembled, {});
    const A = sheet.beats[2];
    expect(A.you).toEqual([fillText(q("q09").question, {})]);
    expect(A.followUps).toEqual([q("q34").question]);
    const Y = sheet.beats[6];
    expect(Y.you).toEqual([q("q41").question]);
    expect(Y.followUps).toEqual(["My own closing words."]);
  });
  it("branches default on at T and Y with the first spoken reframe of each objection group, off elsewhere; a principle never passes", () => {
    expect(defaultBranchIds("T")).toEqual(["r01", "r04", "r07"]);
    expect(defaultBranchIds("Y")).toEqual(["r01", "r04", "r07"]);
    for (const k of ["C", "L", "A", "R", "I"]) expect(defaultBranchIds(k)).toEqual([]);
    expect(branchesFor({ questionIds: [], reframeIds: [], override: null }, "T").map((r) => r.id)).toEqual(["r01", "r04", "r07"]);
    expect(branchesFor({ questionIds: [], reframeIds: [], override: null, branchIds: [] }, "T")).toEqual([]);
    expect(branchesFor({ questionIds: [], reframeIds: [], override: null, branchIds: ["r11", "r07"] }, "C").map((r) => r.id)).toEqual(["r07"]);
    expect(Object.keys(BRANCH_CONDITIONS)).toEqual([...OBJECTION_GROUPS]);
    expect(BRANCH_CONDITIONS["Price / too expensive"]).toBe("If they go to the number");
    expect(BRANCH_CONDITIONS["No time / too busy"]).toBe("If it comes back to time");
    expect(BRANCH_CONDITIONS["Needs a partner's sign-off"]).toBe("If they need to talk to a partner");
  });
  it("the sheet text: no framework letters, YOU then listen-for then branches in quotes with the reframe's name, writing space; the prospect's lines nowhere", () => {
    const sheet = callSheet("Sarah Chen", "Follow-Up", assembled, { X: "the hiring freeze" });
    const text = callSheetText(sheet);
    expect(text.startsWith("FOLLOW-UP — Sarah Chen\nBuilt from CLARITY\n")).toBe(true);
    expect(text).toContain("\n1 · CONTEXT\n\n  YOU\n  Last time we spoke you mentioned the hiring freeze — where did that land?\n\n  Whether it resolved, stalled or got worse.\n");
    expect(text).not.toMatch(/^C — Context/m);
    expect(text).not.toMatch(/\bTHEM\b/);
    expect(text).toContain("  ↳ If they go to the number\n    \"Can I show you the way I'd look at that? Don't look only at the repair bill. Look at the leak.");
    expect(text).toContain("     — Leaky Pipe");
    expect(text).toContain("  ↳ If they need to talk to a partner");
    expect(text).toContain("  _______________________________________________\n  _______________________________________________");
    // Y kept only the branch the client chose (the principle it also named was dropped), T carries the defaults.
    expect(sheet.beats[6].branches.map((b) => b.lines.map((l) => l.name))).toEqual([["Getting in the Same Car"]]);
    expect(sheet.beats[5].branches).toHaveLength(3);
    expect(sheet.beats[0].branches).toEqual([]);
  });
  it("the HTML flavour is block elements only: no <br> anywhere, so no destination turns a line break into a backslash; a credit is carried once", () => {
    const withCredit = { ...REFRAMES.find((r) => r.id === "r01")!, credit: "Someone — “the leak”" };
    const html = callSheetHtml(callSheet("Sarah Chen", "Follow-Up", assembled, {}));
    expect(html).not.toMatch(/<br\s*\/?>/i);
    expect(html).toContain("<em>");
    expect(html).toContain("<p ");
    expect(html).not.toContain("\\");
    // reframeCopyText carries the credit, once; a branch line is exactly that text, so the sheet appends nothing to it.
    expect(reframeCopyText(withCredit).split("Credit:").length).toBe(2);
    const leaky = callSheet("x", "DM", assemble({ T: { questionIds: [], reframeIds: [], override: "Own.", branchIds: ["r01"] } }, LIBRARY_QUESTIONS), {}).beats[5].branches[0].lines[0];
    expect(leaky.said).toBe(reframeCopyText(REFRAMES.find((r) => r.id === "r01")!));
  });
  it("the copy block is the questions only: one per line, no labels, no branches, no blank lines", () => {
    const block = copyBlockText(callSheet("Sarah Chen", "Follow-Up", assembled, { X: "the hiring freeze" }));
    const lines = block.split("\n");
    expect(lines.every((l) => l.trim())).toBe(true);
    expect(lines[0]).toBe("Last time we spoke you mentioned the hiring freeze — where did that land?");
    expect(block).not.toMatch(/YOU|↳|Leaky Pipe|CONTEXT|Built from/);
    expect(lines.at(-1)).toBe("My own closing words.");
  });
});
