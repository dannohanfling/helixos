/**
 * Staging (H-349 §1): the demo workspace and its logins on the staging database, and only there. Every guard the seed has
 * stays (never production, never a remote database without ALLOW_DEMO_SEED=1, never beside a real workspace); on top, the
 * route that runs it answers only on a Vercel preview with the SETUP_TOKEN, the way /setup does.
 */
import { count } from "drizzle-orm";
import { db, schema } from "@/db";
import { seedDemo } from "@/db/seed";
import { safeEqual } from "@/lib/crypto";

export type StagingSeedRefusal = "not-a-preview" | "no-token" | "wrong-token" | "seed-off";

/** Why a staging seed may not run here, or null when it may. Pure over the environment and the token given. */
export function stagingSeedRefusal(env: { VERCEL_ENV?: string; NODE_ENV?: string; SETUP_TOKEN?: string; ALLOW_DEMO_SEED?: string }, token: string): StagingSeedRefusal | null {
  const preview = env.VERCEL_ENV === "preview" || (env.VERCEL_ENV === undefined && env.NODE_ENV !== "production");
  if (!preview) return "not-a-preview";
  if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 16) return "no-token";
  if (!token || !safeEqual(token, env.SETUP_TOKEN)) return "wrong-token";
  if (env.ALLOW_DEMO_SEED !== "1") return "seed-off";
  return null;
}

/** Seeds the demo workspace and reports counts only: no names, no emails. */
export async function seedStaging(): Promise<{ workspaces: number; users: number; memberships: number }> {
  await seedDemo();
  const [[w], [u], [m]] = await Promise.all([db.select({ n: count() }).from(schema.workspaces), db.select({ n: count() }).from(schema.users), db.select({ n: count() }).from(schema.memberships)]);
  return { workspaces: w.n, users: u.n, memberships: m.n };
}
