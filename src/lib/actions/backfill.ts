"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { refresh, str } from "@/lib/action-helpers";
import { requireCoach } from "@/lib/auth";
import { AirtableError, airtableProblem } from "@/lib/airtable";
import { applyBackfill, existingBackfill, readBackfill, workspaceMembers } from "@/lib/coach-backfill";
import { backfillSummary, buildBackfill, type BackfillPlan, type BackfillSummary, type Skipped } from "@/lib/engine/coach-backfill";
import { allow } from "@/lib/rate-limit";

const PAGE = "/coach/backfill";

/** What the dry run shows: the counts, each row's who and when (never the answers themselves), and what stays out and why. */
export type BackfillPreview = {
  key: string;
  summary: BackfillSummary;
  missing: string[];
  feedback: { recordId: string; who: string; month: string; status: "new" | "already" }[];
  ooh: { recordId: string; who: string; friday: string; category: string; status: "new" | "already" }[];
  skipped: Skipped[];
};
export type BackfillState = { error?: string; changed?: boolean; preview?: BackfillPreview } | undefined;

async function prepare(workspaceId: string, coachId: string, f: FormData): Promise<{ error: string } | { plan: BackfillPlan; preview: BackfillPreview }> {
  if (!(await allow(`coach-backfill:${coachId}`, 30, 15 * 60000))) return { error: "That's a lot of runs in a row. Wait 15 minutes and try again." };
  let read: Awaited<ReturnType<typeof readBackfill>>;
  try {
    read = await readBackfill({ baseId: str(f, "base"), token: str(f, "token") });
  } catch (e) {
    if (e instanceof AirtableError) return { error: airtableProblem(e).replace(/^Source base: /, "") };
    return { error: "Couldn't read the base. Nothing was imported; try again in a minute." };
  }
  if (read.missing.length === 2) return { error: "This base has no Client Feedback or Client Support table. Check the base id." };
  const [members, existing] = await Promise.all([workspaceMembers(workspaceId), existingBackfill(workspaceId)]);
  const plan = buildBackfill(read.source, members, existing);
  const key = createHash("sha256").update(JSON.stringify([workspaceId, plan])).digest("hex").slice(0, 32);
  return {
    plan,
    preview: {
      key,
      summary: backfillSummary(plan),
      missing: read.missing,
      feedback: plan.feedback.map((x) => ({ recordId: x.recordId, who: x.who, month: x.month, status: x.status })),
      ooh: plan.ooh.map((x) => ({ recordId: x.recordId, who: x.who, friday: x.friday, category: x.category, status: x.status })),
      skipped: plan.skipped,
    },
  };
}

/**
 * Past monthly feedback and Office Hours requests from Airtable (rev 441). The dry run reads and maps; Approve reads again and
 * writes only if the plan is the one the coach saw. The token is used inside this call and kept nowhere. Coach only, and never
 * while switched into a client.
 */
export async function backfillAction(_prev: BackfillState, f: FormData): Promise<BackfillState> {
  const v = await requireCoach();
  if (v.switchedInto) return { error: "Switch back to your own HelixOS to bring history over." };
  const r = await prepare(v.workspace.id, v.user.id, f);
  if ("error" in r) return { error: r.error };
  if (str(f, "intent") !== "approve") return { preview: r.preview };
  if (r.preview.key !== str(f, "key")) return { changed: true, preview: r.preview };
  const { written } = await applyBackfill(r.plan, v.workspace.id);
  refresh();
  redirect(`${PAGE}?done=${written}&at=${Date.now()}`);
}
