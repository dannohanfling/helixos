import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_PROFILE_MD, BOARD_SKILL_MD, DANNO_SOURCE_PACK_MD } from "@/content/board-spec";
import { EDGE_SEATS, MODES, OFFICE_HOURS_LINE, SEATS, boardTask, checkAnswer, packText, principlesFromPack, seatsFor, workingDay } from "@/lib/engine/board";
import { sectionsFor } from "@/lib/board";
import { toolsFor } from "@/lib/mcp/registry";
import "@/lib/mcp/tools";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
// 2026-10-12 is a Monday.
const ctx = { mode: "board" as const, preset: "standard" as const, hours: 5, today: "2026-10-12", firstQuestion: true, question: "Should I run a webinar this month?", known: "Offers: Coaching ($2,000)" };
const five = SEATS.map((s) => ({ seat: s.key, text: `${s.name} says something useful.` }));
const step = (over: Record<string, unknown> = {}) => ({ do: "Message 10 past clients", by: "2026-10-13", takesMinutes: 60, doneWhen: "10 messages sent", first5: "Open DMs", ...over });

/** My Board (rev 664): ported from Cowork's spec, never re-invented, with the server holding the rules. */
describe("My Board: the spec, ported", () => {
  it("the prompt's copies are docs/board/ word for word", () => {
    expect(BOARD_SKILL_MD).toBe(read("docs/board/SKILL.md"));
    expect(BOARD_PROFILE_MD).toBe(read("docs/board/board-profile.md"));
    expect(DANNO_SOURCE_PACK_MD).toBe(read("docs/board/danno-source-pack.md"));
  });

  it("exactly five seats for clients, named as the profile names them, with their icons; the Edge Preset only by preset", () => {
    expect(SEATS.map((s) => s.name)).toEqual(["Danno", "Alex, the Strategist", "Jordan, the Operator", "Morgan, the Antagonist", "Riley, the Customer Champion"]);
    for (const s of SEATS) expect(BOARD_PROFILE_MD).toContain(`## ${s.name} ${s.emoji}`);
    for (const s of SEATS) expect(read(`public${s.icon}`)).toContain(`aria-label="${s.name}"`);
    expect(seatsFor("standard")).toBe(SEATS);
    expect(seatsFor("edge")).toBe(EDGE_SEATS);
    expect(EDGE_SEATS).toHaveLength(5);
    // Edge only ever for a coach's own Board, never switched in.
    expect(read("src/lib/board.ts")).toMatch(/const preset: Preset = v\.role === "coach" && !v\.switchedInto && v\.membership\.boardPreset === "edge" \? "edge" : "standard";/);
    expect(MODES).toEqual(["board", "focus", "debate", "quick_vote", "workaround", "leverage", "converge", "checkin"]);
  });

  it("Danno's principles come from the pack; its boundaries stay rules", () => {
    const ps = principlesFromPack();
    expect(ps.length).toBeGreaterThanOrEqual(15);
    expect(ps.map((p) => p.title)).toContain("Kind, not nice");
    expect(ps.find((p) => p.title === "Three beliefs to shift")!.body).toContain("I can do it now");
    expect(ps.every((p) => !/program prices/.test(p.body))).toBe(true);
    const text = packText([{ title: "Ship before it's ready", body: "Done beats perfect.", goodFor: "Mindset and growth" }]);
    expect(text).toContain("- **Ship before it's ready.** Done beats perfect.");
    expect(text).toContain("Never quote Danno's program prices.");
    const task = boardTask({ mode: "board", preset: "standard", principles: ps, hours: 5, today: "2026-10-12", firstQuestion: true });
    expect(task).toContain(BOARD_SKILL_MD);
    expect(task).toContain(BOARD_PROFILE_MD);
    expect(task).toContain("all five advisors answer");
    expect(task).toContain("5 hours a week");
  });
});

describe("My Board: the server's checks", () => {
  it("all five on a decision's first question, or the one asked for in Focus", () => {
    expect(checkAnswer({ advisors: five, recommendation: "Do X", steps: [step()] }, ctx).problem).toBeNull();
    expect(checkAnswer({ advisors: five.slice(0, 4), recommendation: "Do X", steps: [step()] }, ctx).problem).toMatch(/4 of its five/);
    // A follow-up uses the few who matter.
    expect(checkAnswer({ advisors: five.slice(0, 3), recommendation: "Do X", steps: [step()] }, { ...ctx, firstQuestion: false }).problem).toBeNull();
    const f = checkAnswer({ advisors: five, recommendation: "Do X", steps: [step()] }, { ...ctx, mode: "focus", focus: "morgan" });
    expect(f.answer.advisors.map((a) => a.seat)).toEqual(["morgan"]);
    // An unknown seat or a second card from the same seat is never shown.
    expect(checkAnswer({ advisors: [...five, { seat: "sixth", text: "x" }, { seat: "alex", text: "again" }], recommendation: "X", steps: [step()] }, ctx).answer.advisors).toHaveLength(5);
  });

  it("one to three steps with all five parts and a real Do, on working days from today, within the hours", () => {
    const c = checkAnswer(
      {
        advisors: five,
        recommendation: "Do X",
        steps: [step({ by: "2026-10-17" }), step({ do: "Think about pricing" }), step({ doneWhen: "" }), step({ do: "Book calls", takesMinutes: 400 }), step()],
      },
      ctx,
    );
    expect(c.answer.steps.map((s) => s.by)).toEqual(["2026-10-19"]);
    expect(c.notes.join(" ")).toMatch(/Moved .* to 2026-10-19, a working day/);
    expect(c.notes.join(" ")).toMatch(/wasn't a real action: "Think about pricing"/);
    expect(c.notes.join(" ")).toMatch(/missing one of its five parts/);
    expect(c.notes.join(" ")).toMatch(/Kept the first three steps/);
    expect(checkAnswer({ advisors: five, recommendation: "X", steps: [step({ by: "2026-10-01" })] }, ctx).answer.steps[0].by).toBe("2026-10-12");
    const tight = checkAnswer({ advisors: five, recommendation: "X", steps: [step({ takesMinutes: 120 }), step({ takesMinutes: 120 }), step({ do: "Book three calls", takesMinutes: 120 })] }, ctx);
    expect(tight.answer.steps).toHaveLength(2);
    expect(tight.notes.join(" ")).toMatch(/Jordan: dropped "Book three calls" so the steps fit your 5 hours a week/);
    expect(workingDay("2026-10-18")).toBe("2026-10-19");
    expect(checkAnswer({ advisors: five, recommendation: "X", steps: [] }, ctx).problem).toMatch(/usable action step/);
  });

  it("no money or percentage the member didn't give; the chair never claims to be Danno; personal questions go to Office Hours", () => {
    const c = checkAnswer(
      {
        advisors: [
          { seat: "danno", text: "Be specific. As Danno, I'd charge more. Name your number." },
          { seat: "alex", text: "Your $2,000 offer is fine. Charge $9,999 instead." },
          ...five.slice(2),
        ],
        assumptions: [{ text: "You close 40% of calls", guess: true }],
        recommendation: "Keep the $2,000 price. It will grow 300%.",
        steps: [step()],
      },
      ctx,
    );
    const danno = c.answer.advisors.find((a) => a.seat === "danno")!.text;
    expect(danno).toBe("Be specific. Name your number.");
    expect(c.answer.advisors.find((a) => a.seat === "alex")!.text).toBe("Your $2,000 offer is fine.");
    expect(c.answer.assumptions).toEqual([]);
    expect(c.answer.recommendation).toBe("Keep the $2,000 price.");
    expect(c.notes.filter((n) => n.startsWith("Left out of"))).toHaveLength(3);
    const personal = checkAnswer({ advisors: five, recommendation: "X", steps: [step()] }, { ...ctx, question: "My marriage is falling apart, should I quit the business?" });
    expect(personal.answer.advisors.find((a) => a.seat === "danno")!.text.endsWith(OFFICE_HOURS_LINE)).toBe(true);
    const tax = checkAnswer({ advisors: five, recommendation: "X", steps: [step()] }, { ...ctx, question: "Should I change my taxes setup?" });
    expect(tax.notes.join(" ")).toMatch(/qualified professional/);
    expect(checkAnswer({ advisors: five, recommendation: "X", steps: [step()] }, ctx).answer.youDecide).toMatch(/You decide/);
  });
});

describe("My Board: what it reads", () => {
  it("reads what the decision is about, always the essentials", () => {
    expect(sectionsFor("What should I charge for my offer?", "board")).toEqual(expect.arrayContaining(["numbers", "offers", "avatars", "proofs"]));
    expect(sectionsFor("Should I run a webinar this month?", "board")).toEqual(expect.arrayContaining(["webinars", "offers", "avatars", "dms", "content"]));
    expect(sectionsFor("Should I run a webinar this month?", "board")).not.toContain("proofs");
    expect(sectionsFor("Hmm.", "board")).toEqual(expect.arrayContaining(["offers", "webinars", "dms", "content", "proofs"]));
    for (const q of ["x", "price"]) expect(sectionsFor(q, "board")).toEqual(expect.arrayContaining(["numbers", "tasks", "intentions", "pathway", "scoreboard", "decisions"]));
  });

  it("HumanOS only through Body's one gate and the member's own switch; never the teaching library; always the member's own rows", () => {
    const src = read("src/lib/board.ts");
    // The one Body read is bodyAiContext (which checks Body's own AI switch), behind HumanOS on and the Board's switch on.
    expect(src).not.toMatch(/schema\.body[A-Z]|db\.query\.body[A-Z]/);
    expect(src).toMatch(/import \{ bodyAiContext \} from "@\/lib\/queries\/body";/);
    expect(src).toMatch(/if \(v\.membership\.bodyEnabled && v\.membership\.boardSeesBody && \(BODY_TOPIC\.test\(question\)/);
    expect(src.match(/bodyAiContext\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/teachingEntries|teaching_entries|storyBank/);
    // Every member query is scoped to the workspace and the member.
    for (const q of src.match(/db\.query\.(offers|avatars|webinars|contacts|proofs|contentItems|ladders|weeklyIntentions|officeHoursRequests|targets)\.find\w+\(\{ where: [^,]+/g) ?? []) expect(q, q).toMatch(/mine\(schema\.\w+\)|and\(mine\(schema/);
  });

  it("four tools on the new My Board tick; asking, approving the set-up and checking in refused to a team member", () => {
    expect(toolsFor(["board"]).map((t) => t.name).sort()).toEqual(["board_apply", "board_ask", "board_checkin", "decisions_list", "whoami"]);
    expect(read("src/lib/board-checkin.ts")).toMatch(/if \(v\.team\) return \{ ok: false/);
    expect(read("src/lib/mcp/tools/board.ts").match(/if \(v\.team\) throw new Error/g)).toHaveLength(2);
    expect(read("src/lib/board-setup.ts")).toMatch(/if \(v\.team\) return \{ ok: false/);
    // board_apply changes nothing without the member's yes.
    expect(read("src/lib/mcp/tools/board.ts")).toMatch(/if \(input\.confirm !== true\) return \{ text: `This will set up:/);
    expect(read("src/lib/actions/board.ts")).toMatch(/ctx\(\{ whileSwitched: "refuse", reason: OWN \}\)/);
  });
});

describe("My Board in Claude (rev 664 §9)", () => {
  it("the skill's folder sits at the archive's root, word for word, with the coach's current principles", async () => {
    const { boardSkillFiles, SKILL_FOLDER, SKILL_INSTALL_STEPS } = await import("@/lib/engine/board");
    const files = boardSkillFiles([{ title: "Walk the floor", body: "Spend an hour inside your client's day.", goodFor: "Offers" }]);
    expect(files.map((f) => f.path)).toEqual([`${SKILL_FOLDER}/SKILL.md`, `${SKILL_FOLDER}/references/board-profile.md`, `${SKILL_FOLDER}/references/danno-source-pack.md`]);
    expect(files.every((f) => f.path.startsWith("evolve-omega-board/"))).toBe(true);
    expect(files[0].text).toBe(read("docs/board/SKILL.md"));
    expect(files[1].text).toBe(read("docs/board/board-profile.md"));
    const pack = files[2].text;
    expect(pack).toContain("## Offers\n\n- **Walk the floor.** Spend an hour inside your client's day.");
    expect(pack).toContain("## Boundaries for Danno");
    expect(SKILL_INSTALL_STEPS).toHaveLength(6);
  });
});
