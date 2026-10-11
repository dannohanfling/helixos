"use server";

/**
 * My Board (rev 664): the page's actions. Asking runs on the member's own AI key, so a coach switched in and a team member are
 * refused before anything runs (a team member can read the decisions, never ask or approve). The Danno Seat's principles are
 * the coach's alone.
 */
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { askBoard } from "@/lib/board";
import { applySetup } from "@/lib/board-setup";
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

/** "Hours I can give my business each week": Jordan keeps every plan within it. */
export async function setBoardHoursAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const hours = Math.round(Number(str(fd, "hours")));
  if (!(hours >= 1 && hours <= 80)) go("/my-board", { error: "Say a number of hours from 1 to 80." }, "hours");
  await db.update(schema.memberships).set({ boardHours: hours }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  go(str(fd, "back") || "/my-board");
}

/** The coach's own Board: the standard five, or the Edge Preset. Never a client's. */
export async function setBoardPresetAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  await db.update(schema.memberships).set({ boardPreset: str(fd, "preset") === "edge" ? "edge" : "standard" }).where(eq(schema.memberships.id, coach.membership.id));
  refresh();
  go("/my-board");
}
