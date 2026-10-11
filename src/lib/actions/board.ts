"use server";

/**
 * My Board (rev 664): the page's actions. Asking runs on the member's own AI key, so a coach switched in and a team member are
 * refused before anything runs (a team member can read the decisions, never ask or approve). The Danno Seat's principles are
 * the coach's alone.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { askBoard } from "@/lib/board";
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

/* ───────── The Danno Seat's principles (rev 664 §8): Danno's own, ok-to-use material only. ───────── */

/** What a principle may never carry: a price, or a story marked for checking or permission. */
function principleProblem(title: string, body: string): string | null {
  if (!title.trim() || !body.trim()) return "Give the principle a title and the principle in plain words.";
  if (/\$\s?\d|\d\s?(usd|nzd|aud|dollars)\b/i.test(`${title} ${body}`)) return "No prices in a principle: the Danno Seat never quotes them.";
  if (/needs permission|\bcheck\b.*story|story.*\bcheck\b/i.test(body)) return "Only material that's yours and ok to use: leave out stories marked to check or needing permission.";
  return null;
}

export async function savePrincipleAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(fd, "id");
  const title = str(fd, "title").slice(0, 120);
  const body = str(fd, "body").slice(0, 2000);
  const goodFor = str(fd, "goodFor").slice(0, 60);
  const problem = principleProblem(title, body);
  if (problem) go("/coach/board", { error: problem }, id ? `p-${id}` : "new");
  const mine = and(eq(schema.boardPrinciples.workspaceId, coach.workspace.id), eq(schema.boardPrinciples.id, id));
  if (id) await db.update(schema.boardPrinciples).set({ title, body, goodFor, updatedAt: nowIso() }).where(mine);
  else {
    const n = (await db.query.boardPrinciples.findMany({ where: eq(schema.boardPrinciples.workspaceId, coach.workspace.id), columns: { id: true } })).length;
    await db.insert(schema.boardPrinciples).values({ id: newId(), workspaceId: coach.workspace.id, title, body, goodFor, order: n });
  }
  refresh();
  go("/coach/board", { saved: "1" });
}

export async function removePrincipleAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  await db.delete(schema.boardPrinciples).where(and(eq(schema.boardPrinciples.workspaceId, coach.workspace.id), eq(schema.boardPrinciples.id, str(fd, "id"))));
  refresh();
  go("/coach/board", { saved: "removed" });
}
