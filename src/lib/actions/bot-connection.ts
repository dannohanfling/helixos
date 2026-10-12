"use server";

/**
 * Bot connection (rev 696): make, rotate and revoke a member's bot key, from Settings (the member) or from the client's bot page
 * (their coach). The key is shown once: it rides to the page in a short-lived cookie and is stored only as its hash. "I've saved
 * it" drops the cookie, and it is never shown again.
 */
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { makeBotKey, revokeBotKey } from "@/lib/bot-mcp/data";
import { BOT_KEY_COOKIE } from "@/lib/engine/bot-mcp";

const OWN = "That's {first}'s own bot key. Make it from their bot page as their coach.";

type Whose = { workspaceId: string; userId: string; membershipId: string; by: string; back: string };
/** The coach acting on a client of theirs, from the client's bot page. */
async function client(coach: Awaited<ReturnType<typeof requireCoach>>, id: string): Promise<Whose> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, id), eq(schema.memberships.workspaceId, coach.workspace.id)) });
  if (!m) redirect("/coach");
  return { workspaceId: m!.workspaceId, userId: m!.userId, membershipId: m!.id, by: coach.user.id, back: `/coach/${m!.id}/bot#bot-connection` };
}
/** The member's own bot, from Settings. */
const self = (v: Awaited<ReturnType<typeof ctx>>["v"]): Whose => ({ workspaceId: v.workspace.id, userId: v.user.id, membershipId: v.membership.id, by: v.user.id, back: "/settings#bot-connection" });

export async function makeBotKeyAction(fd: FormData): Promise<void> {
  const w = str(fd, "membershipId") ? await client(await requireCoach(), str(fd, "membershipId")) : self((await ctx({ whileSwitched: "refuse", reason: OWN })).v);
  const key = await makeBotKey(w, w.by);
  (await cookies()).set(BOT_KEY_COOKIE, JSON.stringify({ m: w.membershipId, key }), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  refresh();
  redirect(w.back);
}

export async function revokeBotKeyAction(fd: FormData): Promise<void> {
  const w = str(fd, "membershipId") ? await client(await requireCoach(), str(fd, "membershipId")) : self((await ctx({ whileSwitched: "refuse", reason: OWN })).v);
  await revokeBotKey(w);
  (await cookies()).delete({ name: BOT_KEY_COOKIE, path: "/" });
  refresh();
  redirect(w.back);
}

export async function hideBotKeyAction(fd: FormData): Promise<void> {
  const w = str(fd, "membershipId") ? await client(await requireCoach(), str(fd, "membershipId")) : self((await ctx({ whileSwitched: "refuse", reason: OWN })).v);
  (await cookies()).delete({ name: BOT_KEY_COOKIE, path: "/" });
  refresh();
  redirect(w.back);
}
