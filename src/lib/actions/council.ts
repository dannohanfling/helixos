"use server";

/**
 * My Board → Choose your council (rev 756 §2 and §3, Danno's answers at rev 766): the member's four chairs and their own custom
 * seats. Theirs alone: refused while a coach is switched in, and for a team member. Changing the council never touches past
 * decisions; each keeps the seats it sat with.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { customSeatsOf, librarySeats } from "@/lib/board-seats";
import { DEFAULT_COUNCIL, MAX_CUSTOM_SEATS, councilProblem, customSeatFromForm } from "@/lib/engine/board-seats";

const PAGE = "/my-board/council";
const OWN = "That's {first}'s own council to choose.";
const go = (path: string, q: Record<string, string> = {}, anchor = "") => redirect(`${path}${Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : ""}${anchor ? `#${anchor}` : ""}`);

/** Save the four chairs in order. A paused or retired seat already in a chair may stay; anything new must be open to them. */
export async function saveCouncilAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const ids = [0, 1, 2, 3].map((i) => str(fd, `chair${i}`));
  const live = v.role === "coach" || v.workspace.expertSeatsLive;
  const rows = await librarySeats(v.workspace.id, { userId: v.user.id });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const had = new Set(v.membership.boardCouncil ?? []);
  const chairs = ids.map((id) => {
    const r = byId.get(id);
    if (!r) return null;
    const open = r.enabled && (r.kind !== "expert" || live);
    return open || had.has(id) ? r : null;
  });
  const problem = councilProblem(chairs);
  if (problem) go(PAGE, { error: problem });
  await db.update(schema.memberships).set({ boardCouncil: ids }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  go("/my-board", { council: "saved" });
}

/** "Keep the classic four" (rev 766): the first-visit prompt's answer, saved so it doesn't ask again. */
export async function keepClassicCouncilAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const rows = await librarySeats(v.workspace.id, { userId: v.user.id });
  const ids = DEFAULT_COUNCIL.map((k) => rows.find((r) => r.kind === "archetype" && r.slug === k)?.id ?? "");
  if (ids.some((x) => !x)) go("/my-board", { error: "The classic four aren't in the library. Ask your coach." });
  await db.update(schema.memberships).set({ boardCouncil: ids }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
  go("/my-board", { council: "classic" });
}

/** Make or edit one of the member's own custom seats (up to two). An edit is a new version; past answers keep theirs. */
export async function saveCustomSeatAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(fd, "id");
  const mine = await customSeatsOf(v.workspace.id, v.user.id);
  const row = id ? mine.find((s) => s.id === id) : null;
  if (id && !row) go(PAGE, { tab: "custom", error: "That seat isn't one of yours." });
  if (!row && mine.length >= MAX_CUSTOM_SEATS) go(PAGE, { tab: "custom", error: `You have ${MAX_CUSTOM_SEATS} custom seats, the most there can be. Edit or remove one first.` });
  const r = customSeatFromForm({
    name: str(fd, "name").slice(0, 120),
    focus: str(fd, "focus").slice(0, 800),
    questions: [0, 1, 2].map((i) => str(fd, `q${i}`).slice(0, 400)),
    voice: str(fd, "voice").slice(0, 600),
    sources: str(fd, "sources").slice(0, 3000),
    realPerson: str(fd, "realPerson") === "1",
    operator: str(fd, "operator") === "1",
  });
  if (!r.ok) go(PAGE, { tab: "custom", ...(id ? { edit: id } : { make: "1" }), error: r.error }, "custom-form");
  const seat = (r as Extract<typeof r, { ok: true }>).seat;
  const values = { name: seat.name, card: seat.card, profile: seat.profile, isOperator: seat.operator, realPerson: seat.realPerson };
  if (row) {
    const before = JSON.stringify({ name: row.name, card: row.card, profile: row.profile, isOperator: row.isOperator, realPerson: row.realPerson });
    if (before !== JSON.stringify(values)) await db.update(schema.boardSeats).set({ ...values, version: row.version + 1, updatedAt: nowIso() }).where(eq(schema.boardSeats.id, row.id));
    refresh();
    go(PAGE, { tab: "custom", saved: "custom" }, `c-${row.id}`);
  }
  const seatId = newId();
  await db.insert(schema.boardSeats).values({ id: seatId, workspaceId: v.workspace.id, userId: v.user.id, slug: `custom-${seatId}`, kind: "custom", areas: [], ...values });
  refresh();
  go(PAGE, { tab: "custom", saved: "custom-new" }, `c-${seatId}`);
}

/** Remove one of the member's custom seats, once it's off their council (a chair is never left empty). */
export async function deleteCustomSeatAction(fd: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: OWN });
  const id = str(fd, "id");
  if ((v.membership.boardCouncil ?? []).includes(id)) go(PAGE, { tab: "custom", error: "That seat is on your council. Swap it out and save first, then remove it." });
  await db.delete(schema.boardSeats).where(and(eq(schema.boardSeats.workspaceId, v.workspace.id), eq(schema.boardSeats.userId, v.user.id), eq(schema.boardSeats.kind, "custom"), eq(schema.boardSeats.id, id)));
  refresh();
  go(PAGE, { tab: "custom", saved: "custom-gone" });
}
