"use server";

/**
 * Coach → Board seats (rev 756 §4): the seat library, the coach's to edit. An edit bumps the seat's version and applies to new
 * answers only (each answer keeps the version it used). Turning a seat off takes it out of the picker; members who have it keep
 * it, marked retired, until they swap it. "Expert seats live" is off at launch and Danno's to turn on after his legal review.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { ensureSeatLibrary } from "@/lib/board-seats";
import { seatFromForm, slugOf } from "@/lib/engine/board-seats";

const PAGE = "/coach/board-seats";
const go = (q: Record<string, string>, anchor = "") => redirect(`${PAGE}?${new URLSearchParams(q).toString()}${anchor ? `#${anchor}` : ""}`);

export async function setExpertSeatsLiveAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  const on = str(fd, "on") === "1";
  await db.update(schema.workspaces).set({ expertSeatsLive: on }).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
  go({ saved: on ? "live" : "off" });
}

export async function setSeatEnabledAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  const id = str(fd, "id");
  const on = str(fd, "on") === "1";
  await db
    .update(schema.boardSeats)
    .set({ enabled: on, updatedAt: nowIso() })
    .where(and(eq(schema.boardSeats.workspaceId, coach.workspace.id), eq(schema.boardSeats.id, id)));
  refresh();
  go({ saved: on ? "on" : "off-seat", area: str(fd, "area") }, `s-${id}`);
}

/** Save an edited seat (its version goes up when anything changed) or add a new expert seat. Custom seats are their members'. */
export async function saveSeatAction(fd: FormData): Promise<void> {
  const coach = await requireCoach();
  await ensureSeatLibrary(coach.workspace.id);
  const id = str(fd, "id");
  const row = id ? await db.query.boardSeats.findFirst({ where: and(eq(schema.boardSeats.workspaceId, coach.workspace.id), eq(schema.boardSeats.id, id)) }) : null;
  if (id && (!row || row.kind === "custom")) go({ error: "That seat isn't in your library." });
  const kind = row?.kind ?? "expert";
  const t = (k: string, max = 2000) => str(fd, k).slice(0, max);
  const r = seatFromForm(
    {
      name: t("name", 120),
      areas: fd.getAll("areas").map(String),
      card: t("card", 300),
      purpose: t("purpose"),
      stance: t("stance"),
      questions: t("questions", 4000),
      frameworks: t("frameworks", 8000),
      speaksUpOn: t("speaksUpOn"),
      evidence: t("evidence"),
      blindSpot: t("blindSpot"),
      voice: t("voice"),
      boundaries: t("boundaries"),
      contribution: t("contribution"),
      sources: t("sources", 4000),
      operator: str(fd, "operator") === "1",
    },
    kind,
  );
  if (!r.ok) go({ edit: id || "new", error: r.error }, "edit");
  const seat = (r as Extract<typeof r, { ok: true }>).seat;
  const values = { name: seat.name, areas: seat.areas, card: seat.card, profile: seat.profile, isOperator: seat.operator };
  if (row) {
    const before = JSON.stringify({ name: row.name, areas: row.areas, card: row.card, profile: row.profile, isOperator: row.isOperator });
    if (before !== JSON.stringify(values)) await db.update(schema.boardSeats).set({ ...values, version: row.version + 1, updatedAt: nowIso() }).where(eq(schema.boardSeats.id, row.id));
    refresh();
    go({ saved: "seat", area: str(fd, "area") }, `s-${row.id}`);
  }
  let slug = slugOf(seat.name);
  const taken = new Set((await db.query.boardSeats.findMany({ where: eq(schema.boardSeats.workspaceId, coach.workspace.id), columns: { slug: true } })).map((s) => s.slug));
  for (let n = 2; taken.has(slug); n++) slug = `${slugOf(seat.name)}-${n}`;
  const newIdValue = newId();
  await db.insert(schema.boardSeats).values({ id: newIdValue, workspaceId: coach.workspace.id, slug, kind: "expert", ...values });
  refresh();
  go({ saved: "added" }, `s-${newIdValue}`);
}
