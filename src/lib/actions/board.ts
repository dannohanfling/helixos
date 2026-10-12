"use server";

/**
 * My Board (rev 664): the page's actions. Asking runs on the member's own AI key, so a coach switched in and a team member are
 * refused before anything runs (a team member can read the decisions, never ask or approve). Danno's principles are
 * the coach's alone.
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { askBoard } from "@/lib/board";
import { applySetup } from "@/lib/board-setup";
import { runCheckin, shareDecision, type StepState } from "@/lib/board-checkin";
import { MODES, type Mode } from "@/lib/engine/board";

const OWN = "The Board answers {first} on their own AI key, so it's theirs to ask.";
const go = (path: string, q: Record<string, string> = {}, anchor = "") => redirect(`${path}${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}${anchor ? `#${anchor}` : ""}`);

/** Ask the Board, or ask again on a decision (parentId). */
export async function askBoardAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const mode = (MODES.find((x) => x === str(fd, "mode")) ?? "board") as Mode;
  const parentId = str(fd, "parentId") || null;
  const r = await askBoard(v, { question: str(fd, "question"), mode, focus: str(fd, "focus") || null, parentId });
  refresh();
  if (r.ok) go(`/my-board/${r.decision.parentId ?? r.decision.id}`, { play: "1" });
  else if (r.decision) go(`/my-board/${r.decision.parentId ?? r.decision.id}`, { error: r.error }, r.decision.parentId ? `d-${r.decision.id}` : "");
  else go(parentId ? `/my-board/${parentId}` : "/my-board", { error: r.error });
}

/** "Set it up for me": apply the ticked proposals of one decision (rev 660); nothing else ever applies them from the page. */
export async function applySetupAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The set-up changes {first}'s HelixOS, so it's theirs to approve." });
  const id = str(fd, "id");
  const back = str(fd, "back") || id;
  const ids = fd.getAll("p").map(String).filter((x) => /^p\d{1,2}$/.test(x));
  const r = await applySetup(v, id, ids);
  refresh();
  if (!r.ok) go(`/my-board/${back}`, { setupError: r.error }, "setup");
  else go(`/my-board/${back}`, { setUp: String(r.applied.length), ...(r.skipped.length ? { skipped: r.skipped.join(" | ").slice(0, 600) } : {}) }, "setup");
}

/** The check-in (rev 664 §6): done, stuck or dropped per step, then the Board in Check-in mode on the same decision. */
export async function checkinAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(fd, "id");
  const n = Math.min(3, Math.max(0, Number(str(fd, "steps")) || 0));
  const states: StepState[] = [];
  for (let i = 0; i < n; i++) {
    const state = str(fd, `s${i}`);
    if (state !== "done" && state !== "stuck" && state !== "dropped") go(`/my-board/${id}`, { checkinError: "Say done, stuck or dropped for every step." }, "checkin");
    states.push({ index: i, state: state as StepState["state"], note: str(fd, `n${i}`).slice(0, 500) || null });
  }
  const r = await runCheckin(v, id, states, str(fd, "note").slice(0, 1000) || null);
  refresh();
  if (!r.ok) go(`/my-board/${id}`, { checkinError: r.error }, "checkin");
  else if (!r.result.ok) go(`/my-board/${id}`, { error: r.result.error });
  else go(`/my-board/${id}`, { play: "1" });
}

/** "Share with my coach" (rev 664 §7): the only way a decision reaches the coach; off again at any time. */
export async function shareDecisionAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(fd, "id");
  const on = str(fd, "on") === "1";
  await shareDecision(v, id, on);
  refresh();
  go(`/my-board/${id}`, { shared: on ? "1" : "0" });
}

/** "Hours I can give my business each week": Jordan keeps every plan within it. */
export async function setBoardHoursAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const hours = Math.round(Number(str(fd, "hours")));
  if (!(hours >= 1 && hours <= 80)) go("/my-board", { error: "Say a number of hours from 1 to 80." }, "hours");
  await db.update(schema.memberships).set({ boardHours: hours }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  go(str(fd, "back") || "/my-board");
}

/** "Let my Board read my HumanOS summary" (rev 664 §3): the member's own switch, off by default; never a coach's to set. */
export async function setBoardSeesBodyAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own switch." });
  await db.update(schema.memberships).set({ boardSeesBody: str(fd, "on") === "1" }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  go("/my-board", {}, "hours-edit");
}

/** The coach's own Board: the standard five, or the Edge Preset. Never a client's. */
export async function setBoardPresetAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  await db.update(schema.memberships).set({ boardPreset: str(fd, "preset") === "edge" ? "edge" : "standard" }).where(eq(schema.memberships.id, coach.membership.id));
  refresh();
  // From Choose your council's Edge Preset card (rev 837), back to the picker; from My Board's fold, back to the room.
  go(str(fd, "back") === "council" ? "/my-board/council" : "/my-board", str(fd, "back") === "council" ? { preset: "saved" } : {});
}
