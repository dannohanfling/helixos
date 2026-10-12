import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkinQuestion } from "@/lib/board-checkin";
import { checkAnswer } from "@/lib/engine/board";
import { rosterLine, scoreboardSections, type Scoreboard } from "@/lib/engine/scoreboard";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const week: Scoreboard = {
  week: { from: "2026-10-05", to: "2026-10-11" },
  days: 7,
  posts: { byChannel: [], total: 0, waiting: 0 },
  comments: 0,
  dms: { started: 0, conversations: 0 },
  calls: 0,
  closes: 0,
  clientsAdded: 0,
  lastIntention: null,
  thisIntention: null,
  keyResults: [],
  kpis: [],
};
const answer = (seats: string[]) => ({
  decision: "d",
  assumptions: [],
  advisors: seats.map((seat) => ({ seat, text: "Counsel.", question: "Why?" })),
  split: "s",
  recommendation: "r",
  steps: [{ do: "Send five DMs", by: "2026-10-13", takesMinutes: 30, doneWhen: "Sent", first5: "Open DMs" }],
  youDecide: "You decide.",
});
const ctx = { mode: "checkin" as const, preset: "standard" as const, hours: 5, today: "2026-10-12", firstQuestion: false, question: "q", known: "" };

describe("My Board check-in, sharing and the scoreboard (rev 664 §6, §7)", () => {
  it("asks in the member's states and words: Jordan for a stuck step, Morgan for a dropped one, then fresh steps", () => {
    const q = checkinQuestion([{ do: "Write the offer" }, { do: "Book calls" }, { do: "Post daily" }], [{ index: 0, state: "done" }, { index: 1, state: "stuck", note: "no replies" }, { index: 2, state: "dropped" }], "Busy week");
    expect(q).toContain('Step 2, "Book calls": stuck (no replies).');
    expect(q).toContain("Jordan: shrink each stuck step");
    expect(q).toContain("Morgan: kindly ask whether each dropped step was a decision or an avoidance");
    expect(q).toContain("What I'd add: Busy week");
    expect(checkinQuestion([{ do: "A" }], [{ index: 0, state: "done" }], null)).not.toMatch(/Jordan|Morgan/);
  });

  it("refuses a check-in answer without Jordan for a stuck step or Morgan for a dropped one", () => {
    expect(checkAnswer(answer(["alex"]), { ...ctx, need: ["jordan", "morgan"] }).problem).toBe("The check-in needs Jordan and Morgan.");
    expect(checkAnswer(answer(["jordan", "morgan"]), { ...ctx, need: ["jordan", "morgan"] }).problem).toBeNull();
  });

  it("counts the week's Board steps on the scoreboard, and only a count of overdue ones on the coach's roster", () => {
    const rows = scoreboardSections({ ...week, boardSteps: { due: 4, done: 3, overdue: 2 } })[0].rows;
    expect(rows.find((r) => r.label === "Board steps")?.value).toBe("3 of 4 done");
    expect(scoreboardSections(week)[0].rows.some((r) => r.label === "Board steps")).toBe(false);
    expect(rosterLine("Maya Torres", { ...week, boardSteps: { due: 4, done: 3, overdue: 2 } })).toMatch(/, 2 Board steps overdue$/);
    expect(rosterLine("Maya Torres", week)).not.toMatch(/Board/);
  });

  it("reaches the coach only through sharing: the one reader of another member's decisions filters on shared", () => {
    const steps = read("src/lib/board-steps.ts");
    expect(steps).toMatch(/isNotNull\(schema\.boardDecisions\.sharedAt\)/);
    // Every other read of the table is the member's own.
    for (const f of ["src/lib/board.ts", "src/lib/board-setup.ts", "src/lib/board-checkin.ts", "src/lib/mcp/tools/board.ts"]) {
      const src = read(f);
      for (const m of src.matchAll(/boardDecisions\.findMany\(\{ where: ([^\n]+)/g)) expect(m[1], f).toMatch(/userId|mine\(schema\.boardDecisions\)|eq\(schema\.boardDecisions\.id/);
    }
    expect(read("src/app/(app)/coach/office-hours/page.tsx")).toMatch(/sharedDecisionsFor\(v\.workspace\.id\)/);
  });
});
