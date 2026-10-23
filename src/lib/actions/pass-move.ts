"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { str } from "@/lib/action-helpers";
import { makeSwitchLink } from "@/lib/pass-move";

/**
 * Moving a program's members to its new pass (H-1859, plan H-1861 approved in H-1868). The coach makes one member's private
 * link by their email (a test member first). The member's press is a plain POST to /pass/new/<token>/make, with no session.
 * Neither sends anything to a pass the member already has.
 */
export async function makeSwitchLinkAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const back = (q: string) => redirect(`/coach?connections=open&${q}`);
  if (coach.switchedInto) back("moveLink=notready");
  const feed = await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.id, str(formData, "feedId")), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
  if (!feed) back("moveLink=notready");
  const got = await makeSwitchLink(feed!, str(formData, "email"), coach.user.id);
  back(got.ok ? `moveLink=made&moveFeed=${feed!.id}&moveToken=${got.token}` : `moveLink=${got.code}&moveFeed=${feed!.id}`);
}
