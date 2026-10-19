"use server";

/** Time zones (H-457): the browser's zone for a member who never had one, and Got it on the one-time line. */
import { ctx } from "@/lib/action-helpers";
import { markZoneNoticeSeen, saveBrowserZone } from "@/lib/zones";

export async function setZoneFromBrowserAction(zone: string): Promise<boolean> {
  const { v } = await ctx({ whileSwitched: "noop", team: "noop" });
  return saveBrowserZone(v, String(zone ?? ""));
}

export async function dismissZoneNoticeAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop", team: "noop" });
  await markZoneNoticeSeen(v);
}
