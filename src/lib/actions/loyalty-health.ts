"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { str } from "@/lib/action-helpers";
import { checkFeed } from "@/lib/leaderboard";
import { saveCert } from "@/lib/loyalty-health";
import { readExpiry, readPassTypeId } from "@/lib/engine/loyalty-health";

const PAGE = "/coach/loyalty-health";
/** The pause between programs on "Check all now", so the agency account is never read in a burst. */
const PACE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A program's Pass Type ID and certificate expiry, typed in from the eLoyalty portal's Certificates page. Coach only. */
export async function saveCertAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) redirect(PAGE);
  const pass = readPassTypeId(str(formData, "passTypeId"));
  const expiry = readExpiry(str(formData, "certExpiresAt"));
  if (!pass.ok) redirect(`${PAGE}?error=pass`);
  if (!expiry.ok) redirect(`${PAGE}?error=date`);
  const saved = await saveCert(str(formData, "id"), coach.workspace.id, pass.value, expiry.value);
  redirect(saved ? `${PAGE}?saved=cert` : PAGE);
}

/**
 * Check all now (H-622 §2.4): the existing read-only check on every program with a key, one at a time, paced, stopping at
 * the first 429 so the agency account is left alone. Every call it makes is a GET. Coach only, never while switched in.
 */
export async function checkAllAction(): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) redirect(PAGE);
  const feeds = await db.query.leaderboardFeeds.findMany({ where: and(eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id), isNotNull(schema.leaderboardFeeds.keyEncrypted)) });
  let passed = 0;
  let failed = 0;
  let busy = false;
  for (let i = 0; i < feeds.length; i++) {
    const r = await checkFeed(feeds[i]);
    if (r.ok) passed++;
    else failed++;
    if (r.busy) {
      busy = true;
      break;
    }
    if (i + 1 < feeds.length) await sleep(PACE_MS);
  }
  console.log(`[loyalty-health] check all: ${passed} passed, ${failed} failed${busy ? ", stopped at a 429" : ""}, of ${feeds.length}`);
  redirect(`${PAGE}?checked=${passed}-${failed}-${feeds.length}${busy ? "-busy" : ""}`);
}
