/**
 * My Board, slice 3 (rev 664 §6, §7): the check-in, sharing with the coach, and the counts the scoreboard and Today read.
 *
 * A step's state is its task's, read live, so ticking the task updates the decision. The check-in records done, stuck or dropped
 * per step, ticks the ones the member says are done, and asks the Board in Check-in mode as a follow-up on the same decision:
 * Jordan shrinks a stuck step, Morgan kindly asks whether a dropped one was a decision or an avoidance, and one to three fresh
 * steps come back (with their own "Set it up for me"). Nothing is deleted. "Share with my coach" is the only way a decision
 * reaches the coach; the coach's roster and scoreboard lines carry counts only.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BoardCheckin } from "@/db/schema";
import type { Viewer } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { toggleTask } from "@/lib/tasks-core";
import { askBoard, type AskResult } from "@/lib/board";
export { boardStepsFor, checkinsDue, sharedDecisionsFor } from "@/lib/board-steps";

type Member = { workspaceId: string; userId: string };
const mine = (v: Viewer): Member => ({ workspaceId: v.workspace.id, userId: v.user.id });

export type StepState = { index: number; state: "done" | "stuck" | "dropped"; note?: string | null };

/** The question the Check-in asks, in the member's own states and words. */
export function checkinQuestion(steps: { do: string }[], states: StepState[], note: string | null): string {
  const line = (s: StepState) => `Step ${s.index + 1}, "${steps[s.index]?.do ?? "?"}": ${s.state}${s.note ? ` (${s.note})` : ""}.`;
  const asks = [
    states.some((s) => s.state === "stuck") ? "Jordan: shrink each stuck step to something that fits this week." : null,
    states.some((s) => s.state === "dropped") ? "Morgan: kindly ask whether each dropped step was a decision or an avoidance." : null,
    "Then one to three fresh steps.",
  ].filter(Boolean);
  return [`Check-in on this decision. ${states.map(line).join(" ")}`, note ? `What I'd add: ${note}` : null, asks.join(" ")].filter(Boolean).join("\n");
}

/**
 * The check-in on one of the member's decisions: every step given a state, the done ones ticked on Tasks (once), the check-in
 * recorded on the decision, and the Board asked in Check-in mode as a follow-up, needing Jordan for a stuck step and Morgan for a
 * dropped one. Refused for a team member and while a coach is switched in (it runs on the member's own AI key).
 */
export async function runCheckin(v: Viewer, decisionId: string, states: StepState[], note: string | null): Promise<{ ok: true; result: AskResult; ticked: number } | { ok: false; error: string }> {
  if (v.team) return { ok: false, error: "A team member can read the Board's decisions but can't check in for the account owner." };
  if (v.switchedInto) return { ok: false, error: "The check-in runs on their own AI key, so it's theirs to do." };
  const m = mine(v);
  const thread = await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId)), orderBy: desc(schema.boardDecisions.createdAt) });
  const top = thread.find((d) => d.id === decisionId && !d.parentId);
  if (!top) return { ok: false, error: "That decision isn't yours or isn't there any more." };
  // The steps being checked: the latest answer on the decision that has steps.
  const latest = thread.find((d) => (d.id === top.id || d.parentId === top.id) && d.answer?.steps.length);
  if (!latest?.answer) return { ok: false, error: "This decision has no steps to check in on." };
  const steps = latest.answer.steps;
  const given = states.filter((s) => s.index >= 0 && s.index < steps.length);
  if (given.length !== steps.length || new Set(given.map((s) => s.index)).size !== steps.length) return { ok: false, error: "Say done, stuck or dropped for every step." };
  let ticked = 0;
  for (const s of given.filter((x) => x.state === "done")) {
    const id = latest.stepTasks[s.index];
    const t = id ? await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, m.userId), eq(schema.tasks.id, id)) }) : null;
    if (t && t.status !== "done") {
      await toggleTask(v, t);
      ticked++;
    }
  }
  const entry: BoardCheckin = { at: nowIso(), steps: given.map((s) => ({ index: s.index, state: s.state })), note: note || null };
  await db.update(schema.boardDecisions).set({ checkins: [...latest.checkins, entry], updatedAt: nowIso() }).where(eq(schema.boardDecisions.id, latest.id));
  const need = [...(given.some((s) => s.state === "stuck") ? ["jordan"] : []), ...(given.some((s) => s.state === "dropped") ? ["morgan"] : [])];
  const result = await askBoard(v, { question: checkinQuestion(steps, given, note), mode: "checkin", parentId: top.id, need });
  return { ok: true, result, ticked };
}

/* ───────────────────────── Sharing (rev 664 §7) ───────────────────────── */

/** "Share with my coach" on, or off again. The member's own decisions only. */
export async function shareDecision(v: Viewer, decisionId: string, on: boolean): Promise<boolean> {
  if (v.team || v.switchedInto) return false;
  const m = mine(v);
  const r = await db
    .update(schema.boardDecisions)
    .set({ sharedAt: on ? nowIso() : null })
    .where(and(eq(schema.boardDecisions.workspaceId, m.workspaceId), eq(schema.boardDecisions.userId, m.userId), eq(schema.boardDecisions.id, decisionId)))
    .returning({ id: schema.boardDecisions.id });
  return r.length > 0;
}
