"use server";

/**
 * My Board (rev 664 §8): Danno's principles, the coach's own (Danno's own, ok-to-use material only). Kept apart from
 * the Board's ask and set-up actions so Coach → Danno compiles only what it uses.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

const go = (path: string, q: Record<string, string> = {}, anchor = "") => redirect(`${path}${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}${anchor ? `#${anchor}` : ""}`);

/* ───────── Danno's principles (rev 664 §8): Danno's own, ok-to-use material only. ───────── */

/** What a principle may never carry: a price, or a story marked for checking or permission. */
function principleProblem(title: string, body: string): string | null {
  if (!title.trim() || !body.trim()) return "Give the principle a title and the principle in plain words.";
  if (/\$\s?\d|\d\s?(usd|nzd|aud|dollars)\b/i.test(`${title} ${body}`)) return "No prices in a principle: Danno never quotes them.";
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
