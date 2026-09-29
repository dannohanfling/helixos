import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { NAV } from "@/components/nav-groups";
import { actionWords, withSwitchError } from "@/lib/engine/switch";

/**
 * "Switch to client" (rev 216), on the server: every write a coach makes while in a client's HelixOS passes through here.
 * Viewing writes nothing; working writes what the coach may do and logs it in plain words for the client; what is the client's
 * own (consent, secrets, exports, sends, their streak, points, their own words) is refused in both modes, with a reason.
 */
export type WhileSwitched = "log" | "refuse" | "noop";

/** Sends the coach back to the page they were on, with the reason beside the form (the shared save button shows it). */
export async function refuseSwitched(reason: string): Promise<never> {
  const h = await headers();
  let path = "/today";
  try {
    const ref = new URL(h.get("referer") ?? "");
    if (ref.host === h.get("host")) path = ref.pathname + ref.search;
  } catch {
    /* no usable referer: Today */
  }
  redirect(withSwitchError(path, reason));
}

/** The request is a server action: its id, when Next sent one. */
async function actionId(): Promise<string | null> {
  return (await headers()).get("next-action");
}

type Manifest = { node?: Record<string, { exportedName?: string }> };
let manifest: Manifest | null = null;
function loadManifest(): Manifest | null {
  // The running server's own map: a dev server's action ids differ from the last production build's.
  const dirs = process.env.NODE_ENV === "production" ? [".next/server"] : [".next/dev/server", ".next/server"];
  for (const dir of dirs) {
    try {
      return JSON.parse(readFileSync(join(process.cwd(), dir, "server-reference-manifest.json"), "utf8")) as Manifest;
    } catch {
      /* next place */
    }
  }
  return null;
}
/**
 * The build's own map of server action ids to their names, for the log's wording only: nothing is refused on it, and without
 * it the log says "Made a change". A dev server adds actions as they compile, so an id not seen yet reads the map again.
 */
function actionName(id: string | null): string | null {
  if (!id) return null;
  if (!manifest?.node?.[id]) manifest = loadManifest();
  return manifest?.node?.[id]?.exportedName ?? null;
}

/** The page the change was made on, as the menu names it, and the item's own name for the pages that edit one item. */
async function whereFrom(v: Viewer): Promise<{ page: string; item: string | null }> {
  const h = await headers();
  let path = "/";
  try {
    path = new URL(h.get("referer") ?? "").pathname;
  } catch {
    /* unknown */
  }
  const nav = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) => path === n.href || path.startsWith(`${n.href}/`));
  const page = nav?.label ?? path;
  const id = path.split("/")[2] ?? "";
  const ws = v.workspace.id;
  const own = { userId: v.user.id };
  let item: string | null = null;
  try {
    if (path.startsWith("/offers/")) item = (await db.query.offers.findFirst({ where: and(eq(schema.offers.id, id), eq(schema.offers.workspaceId, ws), eq(schema.offers.userId, own.userId)) }))?.name ?? null;
    else if (path.startsWith("/webinars/")) item = (await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.workspaceId, ws), eq(schema.webinars.userId, own.userId)) }))?.title ?? null;
    else if (path.startsWith("/magnets/")) item = (await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, id), eq(schema.leadMagnets.workspaceId, ws), eq(schema.leadMagnets.userId, own.userId)) }))?.title ?? null;
    else if (/^\/content\/[^/]+$/.test(path) && id !== "compose" && id !== "ladders") item = (await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.workspaceId, ws), eq(schema.contentItems.userId, own.userId)) }))?.title ?? null;
  } catch {
    item = null;
  }
  return { page, item };
}

/** One log row per request: an action that calls ctx() twice is still one change. */
const loggedThisRequest = cache(() => ({ done: false }));

/**
 * The gate every member write passes through while switched (called by ctx()). "refuse" is for what is the client's own;
 * "noop" for a read-state side effect the caller skips (What's new seen, a tier celebrated); "log" (the default) writes in
 * Work and is refused in View.
 */
export async function switchedWrite(v: Viewer, how: WhileSwitched, reason?: string): Promise<void> {
  const sw = v.switchedInto;
  if (!sw || how === "noop") return;
  const first = sw.clientName.split(" ")[0];
  if (how === "refuse") await refuseSwitched((reason ?? "That's {first}'s own to do, so it can't be done from their HelixOS.").replaceAll("{first}", first));
  if (sw.mode === "view") await refuseSwitched(`You're viewing ${first}'s HelixOS. Switch to Work to make changes${v.membership.coachCanWork ? "" : `, once ${first} lets their coach work in their HelixOS`}.`);
  const once = loggedThisRequest();
  if (once.done) return;
  once.done = true;
  const [{ page, item }, id] = await Promise.all([whereFrom(v), actionId()]);
  await db.insert(schema.coachChanges).values({ id: newId(), workspaceId: v.workspace.id, clientMembershipId: sw.membershipId, userId: v.user.id, coachUserId: v.actor.id, kind: "change", mode: "work", action: actionWords(actionName(id)), page, item });
}

/** Switches in and out, on the coach's own record of them. */
export async function logSwitch(input: { workspaceId: string; clientMembershipId: string; userId: string; coachUserId: string; kind: "switch_in" | "switch_out"; mode: "view" | "work" }): Promise<void> {
  await db.insert(schema.coachChanges).values({ id: newId(), ...input });
}
