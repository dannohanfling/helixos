import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_PROFILE_MD, BOARD_SKILL_MD } from "@/content/board-spec";
import { BOARD_SEAT_LIBRARY_MD } from "@/content/board-seat-library";
import { SEATS, boardSkillFiles, boardTask, checkAnswer, councilSpec, type Seat } from "@/lib/engine/board";
import {
  OPERATOR_AREAS,
  SEAT_AREAS,
  councilProblem,
  effectiveCouncil,
  isEdgeSource,
  looksLikePerson,
  parseArchetypes,
  parseSeatLibrary,
  profileBlock,
  seatFromForm,
  withoutPersonClaims,
  type CouncilRow,
} from "@/lib/engine/board-seats";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const library = parseSeatLibrary(BOARD_SEAT_LIBRARY_MD);
const archetypes = parseArchetypes(BOARD_PROFILE_MD);
const row = (slug: string, over: Partial<CouncilRow> = {}): CouncilRow => {
  const s = [...library, ...archetypes].find((x) => x.slug === slug)!;
  return { id: `id-${slug}`, slug, name: s.name, kind: s.kind, areas: s.areas, card: s.card, isOperator: s.operator, enabled: true, version: 1, profile: s.profile, ...over };
};
const arch = archetypes.map((a) => row(a.slug));
/** A council of Danno and four library seats, as the server builds it. */
const seatFor = (slug: string): Seat => {
  const r = row(slug);
  const classic = SEATS.find((s) => s.key === slug);
  if (classic) return classic;
  return { key: slug, name: r.name, short: r.name, role: r.isOperator ? "OPERATOR" : r.areas[0].toUpperCase(), emoji: "", icon: null, job: r.card, kind: "expert", operator: r.isOperator, id: r.id, version: 1, profile: profileBlock({ name: r.name, kind: r.kind, profile: r.profile, operator: r.isOperator }) };
};
const council = [SEATS[0], ...["alex-hormozi", "james-clear", "seth-godin", "morgan"].map(seatFor)];

describe("My Board: the seat library (rev 756)", () => {
  it("is docs/board/board-seat-library-v1.md word for word", () => {
    expect(BOARD_SEAT_LIBRARY_MD).toBe(read("docs/board/board-seat-library-v1.md"));
  });

  it("seeds 62 expert seats and the 4 archetypes, each person once, every field filled", () => {
    expect(library).toHaveLength(62);
    expect(new Set(library.map((s) => s.slug)).size).toBe(62);
    expect(archetypes.map((a) => a.slug)).toEqual(["alex", "jordan", "riley", "morgan"]);
    for (const s of library) {
      expect(s.name, s.slug).toMatch(/ style$/);
      expect(s.areas.length, s.slug).toBeGreaterThan(0);
      for (const a of s.areas) expect(SEAT_AREAS as readonly string[], `${s.slug}: ${a}`).toContain(a);
      expect(s.card.split(/\s+/).length, s.slug).toBeLessThanOrEqual(20);
      expect(s.profile.questions.length, s.slug).toBeGreaterThanOrEqual(3);
      expect(s.profile.frameworks.length, s.slug).toBeGreaterThan(0);
      expect(s.profile.sources.length, s.slug).toBeGreaterThan(0);
      for (const k of ["purpose", "stance", "speaksUpOn", "evidence", "blindSpot", "voice", "boundaries", "contribution"] as const) expect(s.profile[k], `${s.slug} ${k}`).not.toBe("");
    }
    // A person listed in two areas is one seat with both.
    expect(library.find((s) => s.slug === "russell-brunson")!.areas).toEqual(["Offers & pricing", "Webinars, events & launches"]);
    expect(library.find((s) => s.slug === "mike-michalowicz")!.areas).toEqual(["Business operations & systems", "Money & profit"]);
    // "(top-up of Edge seat)" is the file's note, not the name.
    expect(library.find((s) => s.slug === "tony-robbins")!.name).toBe("Tony Robbins style");
    // Operators: the two operator areas, and Jordan among the archetypes.
    expect(library.filter((s) => s.operator).every((s) => s.areas.some((a) => OPERATOR_AREAS.includes(a)))).toBe(true);
    expect(library.filter((s) => s.operator)).toHaveLength(11);
    expect(archetypes.filter((a) => a.operator).map((a) => a.slug)).toEqual(["jordan"]);
  });

  it("an Edge preset framework stays in the seat's thinking, never as a public source", () => {
    const igor = library.find((s) => s.slug === "igor-pogany")!;
    expect(igor.profile.frameworks.some((f) => isEdgeSource(f.source))).toBe(true);
    const block = profileBlock({ name: igor.name, kind: "expert", profile: igor.profile, operator: false });
    expect(block).toContain("The Human Advantage");
    expect(block).not.toMatch(/Source: Edge preset/i);
    expect(igor.profile.sources.some((s) => /edge preset/i.test(s.label))).toBe(false);
  });
});

describe("My Board: a member's council (rev 756, rev 766)", () => {
  it("defaults to the archetypes in chair order: left, right, front left, front right", () => {
    expect(effectiveCouncil([null, null, null, null], false, arch).map((c) => c.slug)).toEqual(["alex", "jordan", "riley", "morgan"]);
  });

  it("while expert seats are off, each paused seat's chair sits with the archetype for its role; the picks return when it's on", () => {
    const picks = [row("alex-hormozi"), row("james-clear"), row("riley"), row("seth-godin")];
    const off = effectiveCouncil(picks, false, arch);
    // James Clear is an operator: Jordan takes his chair; the others take their chair's own archetype.
    expect(off.map((c) => `${c.slug}${c.paused ? " (paused)" : ""}`)).toEqual(["alex (paused)", "jordan (paused)", "riley", "morgan (paused)"]);
    expect(effectiveCouncil(picks, true, arch).map((c) => c.slug)).toEqual(["alex-hormozi", "james-clear", "riley", "seth-godin"]);
    // Never an archetype twice: Jordan already picked, a paused operator elsewhere takes the next free one.
    const twice = effectiveCouncil([row("jordan"), row("james-clear"), null, null], false, arch);
    expect(new Set(twice.map((c) => c.slug)).size).toBe(4);
    expect(twice[0].slug).toBe("jordan");
  });

  it("a seat the coach turned off stays, marked retired, until the member swaps it", () => {
    const c = effectiveCouncil([row("alex-hormozi", { enabled: false }), row("james-clear"), null, null], true, arch);
    expect(c[0]).toMatchObject({ slug: "alex-hormozi", retired: true });
  });

  it("saving needs four seats, one an operator, each once", () => {
    expect(councilProblem([row("alex-hormozi"), row("seth-godin"), row("riley"), null])).toBe("Pick four seats for your council.");
    expect(councilProblem([row("alex-hormozi"), row("seth-godin"), row("riley"), row("morgan")])).toBe("Pick at least one operator seat so your Board ends with clear action steps.");
    expect(councilProblem([row("alex-hormozi"), row("alex-hormozi"), row("jordan"), row("morgan")])).toBe("A seat can sit in one chair only.");
    expect(councilProblem([row("alex-hormozi"), row("james-clear"), row("riley"), row("morgan")])).toBeNull();
  });
});

describe("My Board: the answer engine with a council (rev 756 §5)", () => {
  it("the classic five keep the spec word for word; a council gets its names, the style-advisor rule and its operator", () => {
    expect(councilSpec(SEATS)).toEqual({ skill: BOARD_SKILL_MD, profile: BOARD_PROFILE_MD });
    const spec = councilSpec(council);
    expect(spec.skill).toContain("five advisors (Danno, Alex Hormozi style, James Clear style, Seth Godin style, Morgan, the Antagonist)");
    expect(spec.skill).not.toContain("No celebrity or real-person seats");
    expect(spec.skill).toContain('never say "I am {Name}"');
    expect(spec.profile).toContain("## Danno 🧭");
    expect(spec.profile).toContain("## Alex Hormozi style");
    expect(spec.profile).toContain("## Morgan, the Antagonist ⚡");
    expect(spec.profile).toContain("James Clear style is the operator: they own the action steps.");
    expect(spec.profile).toContain("the recommendation still names the main risk in one line");
    // The skill download is the member's council too.
    const files = boardSkillFiles([], council);
    expect(files[1].text).toBe(spec.profile);
  });

  it("an answer uses exactly the member's five seats, and the operator writes the steps", () => {
    const task = boardTask({ mode: "board", preset: "standard", seats: council, principles: [], hours: 5, today: "2026-10-12", firstQuestion: true });
    expect(task).toContain('"seat": "danno|alex-hormozi|james-clear|seth-godin|morgan"');
    expect(task).toMatch(/james-clear: James Clear style \(.*\) — the operator: owns the action steps/);
    const advice = council.map((s) => ({ seat: s.key, text: `${s.short} has a view.`, question: "What will you measure?" }));
    const steps = [1, 2].map((n) => ({ do: `Send ${n} offer messages`, by: "2026-10-13", takesMinutes: 200, doneWhen: "sent", first5: "Open DMs" }));
    const ok = checkAnswer({ advisors: advice, recommendation: "Do it.", split: "x", steps }, { mode: "board", preset: "standard", seats: council, hours: 5, today: "2026-10-12", firstQuestion: true, question: "Q", known: "" });
    expect(ok.problem).toBeNull();
    expect(ok.answer.advisors.map((a) => a.seat)).toEqual(council.map((s) => s.key));
    // The operator trims the steps to the hours, by name.
    expect(ok.notes.join(" ")).toContain("James Clear style: dropped");
    // A seat outside the council never answers; four of five on a first question is a problem.
    const short = checkAnswer({ advisors: [...advice.slice(0, 4), { seat: "alex", text: "Not here." }], recommendation: "Do it.", steps }, { mode: "board", preset: "standard", seats: council, hours: 5, today: "2026-10-12", firstQuestion: true, question: "Q", known: "" });
    expect(short.problem).toBe("The Board gave 4 of its five advisors.");
  });

  it("no answer keeps 'I am {Name}' or a quote put in the person's mouth (a sample of answers)", () => {
    const samples = [
      "I am Alex Hormozi, and I'd raise the price.",
      "As Alex Hormozi, my answer is simple.",
      'Hormozi says "make an offer so good people feel stupid saying no".',
      '"Volume negates luck" - Alex Hormozi.',
      "Alex Hormozi once said you should double down.",
      "Speaking as Hormozi: sell more.",
    ];
    for (const line of samples) {
      const r = withoutPersonClaims(`Work the four levers. ${line} Start with the guarantee.`, "Alex Hormozi style");
      expect(r.cut, line).toBe(true);
      expect(r.text, line).toBe("Work the four levers. Start with the guarantee.");
    }
    // Plain advice in the seat's style stays.
    expect(withoutPersonClaims("Work the Value Equation's four levers this week.", "Alex Hormozi style").cut).toBe(false);
    const checked = checkAnswer(
      { advisors: council.map((s) => ({ seat: s.key, text: s.key === "alex-hormozi" ? "Raise the guarantee. I am Alex Hormozi." : "A view." })), recommendation: "Do it.", steps: [{ do: "Send 10 messages", by: "2026-10-13", takesMinutes: 30, doneWhen: "sent", first5: "Open DMs" }] },
      { mode: "board", preset: "standard", seats: council, hours: 5, today: "2026-10-12", firstQuestion: true, question: "Q", known: "" },
    );
    expect(checked.answer.advisors.find((a) => a.seat === "alex-hormozi")!.text).toBe("Raise the guarantee.");
    expect(checked.notes.join(" ")).toContain("style advisors never do");
  });
});

describe("My Board: the coach's seat editor (rev 756 §4)", () => {
  const form = { name: "Pat Example style", areas: ["Sales & closing"], card: "Short card.", purpose: "p", stance: "s", questions: "One?\nTwo?", frameworks: "Thing: does it (Source: A book)\nEdge one: inner (Source: Edge preset)", speaksUpOn: "x", evidence: "", blindSpot: "b", voice: "v", boundaries: "h", contribution: "c", sources: "A book (2020)\nSite: https://example.com", operator: false };
  it("reads the library's own line shapes back, and refuses what an expert seat can't be", () => {
    const r = seatFromForm(form, "expert");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.seat.profile.frameworks).toEqual([
      { name: "Thing", text: "does it", source: "A book" },
      { name: "Edge one", text: "inner", source: "Edge preset" },
    ]);
    expect(r.seat.profile.sources).toEqual([
      { label: "A book (2020)", url: null },
      { label: "Site", url: "https://example.com" },
    ]);
    expect(seatFromForm({ ...form, name: "Pat Example" }, "expert")).toEqual({ ok: false, error: 'An expert seat is named "{Name} style".' });
    expect(seatFromForm({ ...form, areas: [] }, "expert")).toEqual({ ok: false, error: "Pick at least one skill area." });
    expect(seatFromForm({ ...form, card: Array(21).fill("word").join(" ") }, "expert")).toEqual({ ok: false, error: "Keep the card to 20 words or fewer." });
  });
  it("tells a real person's name from a seat's description", () => {
    expect(looksLikePerson("Pat Example")).toBe(true);
    expect(looksLikePerson("Pat Example style")).toBe(true);
    expect(looksLikePerson("My money coach")).toBe(false);
  });
});
