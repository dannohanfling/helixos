/**
 * Hermes's per-webinar settings (hermes_pages) and the one rule every page and mf_prepare follow: is this webinar's HelixOS page
 * open? On production only when "Host pages in HelixOS" is on. A database the table hasn't reached yet (migration 0153, run on
 * deploy) reads as "switch off", so nothing breaks. On a Vercel Preview the pages open for any webinar whose Magic funnel
 * is live, so Danno and Scriba can test them before the switch exists; mf_prepare never hands out a Preview address.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { siteUrl } from "@/lib/app-url";
import { hermesPages, type HermesPage } from "@/db/schema-hermes";

type Member = { workspaceId: string; userId: string };

/** A Vercel Preview deployment. Production and local runs are not. */
export const previewDeploy = () => process.env.VERCEL_ENV === "preview";

let warned = false;
/** The settings row for a webinar; null when there is none or the table isn't on this database yet. Never throws. */
export async function hermesFor(webinarId: string): Promise<HermesPage | null> {
  try {
    const rows = await db.select().from(hermesPages).where(eq(hermesPages.webinarId, webinarId)).limit(1);
    return rows[0] ?? null;
  } catch {
    if (!warned) console.warn("[hermes] hermes_pages unreadable; HelixOS pages read as switched off");
    warned = true;
    return null;
  }
}

/** Every webinar of a member (or of everyone) with the switch on. Empty when the table isn't there. */
export async function hostedWebinarIds(m: Member | null): Promise<string[]> {
  try {
    const rows = await db
      .select({ webinarId: hermesPages.webinarId })
      .from(hermesPages)
      .where(m ? and(eq(hermesPages.hostOn, true), eq(hermesPages.workspaceId, m.workspaceId), eq(hermesPages.userId, m.userId)) : eq(hermesPages.hostOn, true));
    return rows.map((r) => r.webinarId);
  } catch {
    return [];
  }
}

/** The switch, for this member's webinar: on only for its own row. */
export const hostOn = (row: HermesPage | null, m: Member) => Boolean(row?.hostOn && row.workspaceId === m.workspaceId && row.userId === m.userId);

/** A page open to prospects: production needs the switch; a Preview needs only the live Magic funnel the caller checked. */
export const pagesOpen = (row: HermesPage | null, m: Member) => hostOn(row, m) || previewDeploy();

export const personalPath = (code: string) => `/mf/${code}`;
export const coldPath = (webinarId: string) => `/mf/w/${webinarId}`;

/**
 * Hook 1 (mf_prepare in src/lib/mf/data.ts): the HelixOS page address for this webinar's codes when its switch is on, else
 * null and mf_prepare keeps the GoHighLevel link. Production only: a Preview never changes what the bot sends.
 */
export async function hostedUrl(m: Member, webinarId: string): Promise<((code: string) => string) | null> {
  if (previewDeploy()) return null;
  const row = await hermesFor(webinarId);
  if (!hostOn(row, m)) return null;
  const base = siteUrl();
  return (code: string) => `${base}${personalPath(code)}`;
}
