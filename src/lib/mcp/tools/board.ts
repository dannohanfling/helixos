/**
 * My Board by voice (rev 664 §10): the same Board as the page, through the same askBoard (the same context, prompt and checks),
 * spoken summary first and the steps numbered. The decision is saved to the member's log exactly as one asked on the page.
 */
import { z } from "zod";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { askBoard, decisionsFor, stepStatus } from "@/lib/board";
import { MODES, seatsFor, spokenAnswer, type Mode } from "@/lib/engine/board";
import { setupReadBack } from "@/lib/engine/board-setup";
import { applySetup } from "@/lib/board-setup";
import { runCheckin } from "@/lib/board-checkin";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

defineTool({
  name: "board_ask",
  scope: "board",
  kind: "write",
  description:
    "Asks the member's Board (five advisors: the Danno Seat, Alex the Strategist, Jordan the Operator, Morgan the Antagonist, Riley the Customer Champion) about a decision, grounded in their own HelixOS. Modes: board, focus (with advisor: danno, alex, jordan, morgan or riley), debate, quick_vote, workaround, leverage, converge, checkin. Read the recommendation first, then the numbered action steps; the member decides. Saved to their decision log. Needs their AI key and their weekly hours set in HelixOS.",
  input: {
    decision: z.string().min(3).max(4000).describe("What the member is deciding, in their words"),
    mode: z.enum(MODES).optional().describe("board (the default), focus, debate, quick_vote, workaround, leverage, converge or checkin"),
    advisor: z.string().max(20).optional().describe("For focus: danno, alex, jordan, morgan or riley"),
    follow_up_on: z.string().max(60).optional().describe("Optional: a decision's id from decisions_list, to ask more about it"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    if (v.team) throw new Error("A team member can read the Board's decisions but can't ask it for the account owner.");
    const r = await askBoard(v, { question: String(input.decision ?? ""), mode: (input.mode as Mode) ?? "board", focus: input.advisor ? String(input.advisor).toLowerCase() : null, parentId: input.follow_up_on ? String(input.follow_up_on) : null });
    if (!r.ok) throw new Error(r.error);
    const d = r.decision;
    const link = `${appUrl()}/my-board/${d.parentId ?? d.id}`;
    const setup = d.proposals.length ? `\n\nIt can set this up for you (nothing changes until you say yes; board_apply with the numbers):\n${setupReadBack(d.proposals)}` : "";
    return { text: `${spokenAnswer(d.answer!, seatsFor(d.preset))}${setup}\n\nOpen it: ${link}`, data: { id: d.id, decision: d.answer!.decision, recommendation: d.answer!.recommendation, steps: d.answer!.steps, notes: d.notes, used: d.used.map((u) => u.label), proposals: d.proposals.map((p, i) => ({ n: i + 1, id: p.id, kind: p.kind, title: p.title, before: p.before ?? null, after: p.after ?? null })), link } };
  },
});

defineTool({
  name: "decisions_list",
  scope: "board",
  kind: "read",
  description: "The member's recent Board decisions, newest first and numbered: what they asked, the recommendation, and how many of its steps are done.",
  input: { limit: z.number().int().min(1).max(20).optional().describe("How many, default 10") },
  handler: async (v, input): Promise<ToolResult> => {
    const rows = await decisionsFor(v, Number(input.limit ?? 10));
    if (!rows.length) return { text: "No Board decisions yet.", data: { decisions: [] } };
    const lines = await Promise.all(
      rows.map(async ({ decision: d }, i) => {
        const st = await stepStatus(v.user.id, d);
        return { n: i + 1, id: d.id, question: d.question, decision: d.answer?.decision ?? null, setUp: d.applied.length, shared: Boolean(d.sharedAt), recommendation: d.answer?.recommendation ?? null, stepsDone: st.filter((x) => x === "done").length, steps: st.length, date: d.createdAt.slice(0, 10) };
      }),
    );
    return { text: `${lines.length} decision${lines.length === 1 ? "" : "s"}:\n${lines.map((l) => `${l.n}. ${l.question}${l.recommendation ? ` The Board recommends: ${l.recommendation}` : " No answer yet."} (${l.stepsDone} of ${l.steps} steps done)`).join("\n")}`, data: { decisions: lines } };
  },
});

defineTool({
  name: "board_apply",
  scope: "board",
  kind: "write",
  description:
    "Sets up what a Board answer proposed (\"Set it up for me\"), the same as ticking them and pressing Approve on the decision: tasks for the steps, the check-in, and any 3-1-3, target, follow-up, content draft, draft webinar, draft offer, testimonial ask or Office Hours question it listed. Everything is a draft or private. Call it first without confirm to get the read-back of exactly what will change, read it to the member, and only after their yes call again with confirm: true. An item that changes something existing (before → after) is set up only if they named it.",
  input: {
    decision: z.string().min(3).max(60).describe("The decision's id, from board_ask or decisions_list"),
    items: z.array(z.number().int().min(1).max(7)).min(1).max(7).describe("The numbers of the proposals the member wants, as board_ask listed them"),
    confirm: z.boolean().optional().describe("true only after the member said yes to the read-back"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    if (v.team) throw new Error("A team member can read the Board's decisions but can't approve its set-up.");
    const id = String(input.decision ?? "");
    const d = await db.query.boardDecisions.findFirst({ where: and(eq(schema.boardDecisions.workspaceId, v.workspace.id), eq(schema.boardDecisions.userId, v.user.id), eq(schema.boardDecisions.id, id)) });
    if (!d || !d.answer) throw new Error("That decision isn't yours or has no answer to set up.");
    const nums = [...new Set((input.items as number[]) ?? [])];
    const picked = nums.map((n) => d.proposals[n - 1]).filter(Boolean);
    if (!picked.length) throw new Error(`Pick from 1 to ${d.proposals.length}.`);
    const done = new Set(d.applied.map((a) => a.proposalId));
    const todo = picked.filter((p) => !done.has(p.id));
    if (!todo.length) return { text: "Those are already set up.", data: { applied: [] } };
    if (input.confirm !== true) return { text: `This will set up:\n${setupReadBack(todo)}\n\nNothing has changed yet: read this back and call again with confirm: true only after their yes.`, data: { applied: [], pending: todo.map((p) => p.id) } };
    const r = await applySetup(v, d.id, todo.map((p) => p.id));
    if (!r.ok) throw new Error(r.error);
    return { text: `Set up ${r.applied.length} of ${todo.length}.${r.skipped.length ? ` Not set up: ${r.skipped.join("; ")}.` : ""} Each links back to the decision: ${appUrl()}/my-board/${d.parentId ?? d.id}`, data: { applied: r.applied, skipped: r.skipped } };
  },
});

defineTool({
  name: "board_checkin",
  scope: "board",
  kind: "write",
  description:
    "Checks in on a Board decision's action steps, the same as Check in on the decision's page: say done, stuck or dropped for every step (decisions_list or board_ask give the steps). Done steps are ticked on the member's Tasks. Then the Board answers in Check-in mode: Jordan shrinks a stuck step, Morgan kindly asks whether a dropped one was a decision or an avoidance, and one to three fresh steps. Read the recommendation first, then the steps.",
  input: {
    decision: z.string().min(3).max(60).describe("The decision's id, from decisions_list or board_ask"),
    steps: z.array(z.object({ n: z.number().int().min(1).max(3), state: z.enum(["done", "stuck", "dropped"]), note: z.string().max(500).optional() })).min(1).max(3).describe("Every step by its number, with done, stuck or dropped, and what happened if they said"),
    note: z.string().max(1000).optional().describe("Anything else the member wants the Board to know"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const steps = (input.steps as { n: number; state: "done" | "stuck" | "dropped"; note?: string }[]).map((x) => ({ index: x.n - 1, state: x.state, note: x.note ?? null }));
    const r = await runCheckin(v, String(input.decision ?? ""), steps, input.note ? String(input.note) : null);
    if (!r.ok) throw new Error(r.error);
    if (!r.result.ok) throw new Error(r.result.error);
    const d = r.result.decision;
    const link = `${appUrl()}/my-board/${d.parentId ?? d.id}`;
    return { text: `${r.ticked ? `Ticked ${r.ticked} done on your Tasks. ` : ""}${spokenAnswer(d.answer!, seatsFor(d.preset))}\n\nOpen it: ${link}`, data: { id: d.id, ticked: r.ticked, recommendation: d.answer!.recommendation, steps: d.answer!.steps, link } };
  },
});
