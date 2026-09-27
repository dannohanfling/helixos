"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";
import { parsePicks, planKey, planMove } from "@/lib/engine/move";
import { MOVE_TABLES, moveWorldFor } from "@/lib/queries/move";

/**
 * Move the coach's picked items, and what they carry, to one of their clients (handoff 27 Sep). Coach only; the client is a live
 * client in the same workspace. The plan is worked out again from the database and must match the one the coach saw (its key),
 * or nothing moves. Each row keeps everything but its owner: a proof keeps its permission record, children follow their parent.
 */
export async function moveToClientAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const clientId = str(formData, "clientId");
  const client = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, clientId), eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  if (!client) redirect("/coach/move?error=client");
  const picked = parsePicks(formData.getAll("pick").map(String));
  const world = await moveWorldFor(v.workspace.id, v.user.id);
  const plan = planMove(world, picked);
  if (!plan.moves.length) redirect("/coach/move?error=empty");
  if (planKey(client.id, plan) !== str(formData, "key")) redirect(`/coach/move?changed=1&client=${client.id}&${picked.map((p) => `pick=${p.kind}:${p.id}`).join("&")}`);
  for (const m of plan.moves) {
    const t = MOVE_TABLES[m.kind] as typeof schema.offers;
    await db
      .update(t)
      .set({ userId: client.userId })
      .where(and(eq(t.id, m.id), eq(t.workspaceId, v.workspace.id), eq(t.userId, v.user.id)));
  }
  refresh();
  redirect(`/coach/move?moved=${plan.moves.length}&to=${client.id}`);
}
