"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";
import { navStateOf } from "@/lib/engine/nav-state";

/** Remembers the menu's state on the membership (H-333). Nothing is written while a coach is switched into the member, and a team member is refused by the gate; the provider never calls this for either. */
export async function saveNavStateAction(raw: unknown): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto || v.team) return;
  const state = navStateOf(raw);
  await db.update(schema.memberships).set({ navState: state }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.userId, v.user.id)));
}
