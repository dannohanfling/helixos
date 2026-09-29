"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";
import { WHATS_NEW } from "@/content/whats-new";
import { newestSeenable } from "@/lib/engine/whats-new";

/** Opening What's new (rev 193) clears the menu's dot: the newest entry this member can see is marked seen. Never goes back. */
export async function markWhatsNewSeenAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  // A coach switched into a client's HelixOS (rev 216) never marks What's new seen for them.
  if (v.switchedInto) return;
  const newest = newestSeenable(WHATS_NEW, v.role);
  if (newest <= (v.membership.whatsNewSeen ?? 0)) return;
  await db.update(schema.memberships).set({ whatsNewSeen: newest }).where(eq(schema.memberships.id, v.membership.id));
}
