"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { refresh, str } from "@/lib/action-helpers";

export async function setClientPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const enabled = str(formData, "enabled") === "1";
  const tier = str(formData, "programTier");
  await db
    .update(schema.memberships)
    .set({ passEnabled: enabled, ...(tier ? { programTier: tier } : {}) })
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}
