"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, refresh } from "@/lib/action-helpers";
import { createMemberPass } from "@/lib/eo-pass";

/**
 * "Get my pass" on Rewards (H-622): the member's own press creates their Evolve Omega pass, once. Never for a coach working in
 * a client's HelixOS, never for a team member: a pass is the member's own.
 */
export async function getMyPassAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "A pass is {first}'s own: only they can get it.", team: "refuse" });
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, v.membership.id) });
  if (!m) redirect("/rewards");
  const r = await createMemberPass(m, { name: v.user.name, email: v.user.email });
  refresh();
  redirect(r.ok ? "/rewards?pass=ready#eo-pass" : `/rewards?passError=${encodeURIComponent(r.why)}#eo-pass`);
}
