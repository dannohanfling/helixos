import { describe, expect, it } from "vitest";
import { CLARITY_BEATS, LESSONS, LIBRARY_QUESTIONS, OBJECTION_GROUPS, REFRAMES, SCRIPT_TYPES, assemble, beatByStage, hasBuildNote, lessonParagraphs, progress, questionsFor, reframesByGroup, scriptText } from "../socrates";

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
  it("has 11 reframes in the four groups, 3 / 3 / 3 / 2, and Shoulder to Shoulder carries its credit", () => {
    expect(REFRAMES).toHaveLength(11);
    expect(reframesByGroup().map((g) => [g.group, g.reframes.length])).toEqual(OBJECTION_GROUPS.map((g, i) => [g, i === 3 ? 2 : 3]));
    expect(REFRAMES.find((r) => r.name === "Shoulder to Shoulder")?.credit).toBe("Alex Hormozi");
  });
  it("keeps the build note out of what a client reads, and only that", () => {
    const four = LESSONS.find((l) => l.order === 4)!;
    expect(hasBuildNote(four.body)).toBe(true);
    expect(lessonParagraphs(four.body).join("\n")).not.toMatch(/Note for the app build/);
    expect(lessonParagraphs(four.body).length).toBe(four.body.split(/\n\s*\n/).length - 1);
    const six = LESSONS.find((l) => l.order === 6)!;
    expect(lessonParagraphs(six.body).length).toBe(six.body.split(/\n\s*\n/).length);
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
    expect(text).toContain("Do not look only at the repair bill. Look at the leak.");
    expect(text).toContain("Then my bridge.");
    expect(text.indexOf("Look at the leak.")).toBeLessThan(text.indexOf("Then my bridge."));
  });
});
