"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { allow } from "@/lib/rate-limit";
import { newId } from "@/lib/ids";
import { AirtableError, airtableProblem, readFields, type BaseAccess } from "@/lib/airtable";
import { HEADSHOT_IMPORT, attachmentProblem, attachmentUrlAllowed, dryRunLine, matchedCount, parseRow, planImport, type HeadshotRow, type MemberRef } from "@/lib/engine/headshots";
import { dropReviewObjects, removeMemberHeadshot, setMemberHeadshot, storeHeadshot } from "@/lib/headshots";

/**
 * Client headshots from Airtable (Danno, 8 Oct). The coach runs it from Coach → Client headshots: the token pasted for that run
 * only (never stored, logged or shown back, as the Proof Bank import takes it), the Fulfillment table read by field id, a dry
 * run first that writes nothing, then apply. Each matched photo is downloaded at once (Airtable's addresses expire) into the
 * private store; anything not matched to exactly one client goes to the review list with its photo. Never a guess.
 */
const back = (q: string) => redirect(`/coach/headshots?${q}#import`);

/** Fetches one attachment from Airtable's own hosts (or the walk's mock), capped; the address is never logged. */
async function download(row: HeadshotRow): Promise<Buffer | { error: string }> {
  const a = row.attachment!;
  const problem = attachmentProblem(a);
  if (problem) return { error: problem };
  if (!attachmentUrlAllowed(a.url, process.env.AIRTABLE_API_URL || "https://api.airtable.com")) return { error: "an address that is not Airtable's" };
  try {
    const res = await fetch(a.url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) return { error: `Airtable answered ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length ? bytes : { error: "an empty file" };
  } catch {
    return { error: "the download did not finish" };
  }
}

/** Runs a list of jobs a few at a time: a hundred photos, four downloads in flight. */
async function inBatches<T>(items: T[], n: number, job: (t: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(job));
}

export async function importHeadshotsAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) back(`error=${encodeURIComponent("Switch back to your own HelixOS first.")}`);
  if (!(await allow(`headshot-import:${v.user.id}`, 12, 15 * 60000))) back(`error=${encodeURIComponent("That's a lot of runs in a row. Wait 15 minutes and try again.")}`);
  const apply = str(formData, "mode") === "apply";
  const access: BaseAccess = { baseId: str(formData, "baseId").trim() || HEADSHOT_IMPORT.baseId, token: str(formData, "token") };
  const tableId = str(formData, "tableId").trim() || HEADSHOT_IMPORT.tableId;
  let raw: { id: string; fields: Record<string, unknown> }[];
  try {
    raw = await readFields(access, tableId, Object.values(HEADSHOT_IMPORT.fields));
  } catch (e) {
    if (e instanceof AirtableError) back(`error=${encodeURIComponent(airtableProblem(e))}`);
    throw e;
  }
  const rows = raw.map(parseRow);
  // The workspace's clients and the coach, by their sign-in email.
  const ms = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), isNull(schema.memberships.removedAt)), columns: { id: true, userId: true, headshotSource: true, headshotAirtableId: true } });
  const users = ms.length ? await db.query.users.findMany({ where: inArray(schema.users.id, ms.map((m) => m.userId)), columns: { id: true, email: true } }) : [];
  const emailOf = new Map(users.map((u) => [u.id, u.email.trim().toLowerCase()]));
  const members: MemberRef[] = ms.map((m) => ({ membershipId: m.id, email: emailOf.get(m.userId) ?? "", source: m.headshotSource, airtableId: m.headshotAirtableId }));
  const plan = planImport(rows, members);
  // A review row already made for the same attachment, whatever became of it, is not made again.
  const known = new Set((await db.query.headshotReviews.findMany({ where: eq(schema.headshotReviews.workspaceId, v.workspace.id), columns: { attachmentId: true } })).map((r) => r.attachmentId));
  const newReviews = plan.review.filter((r) => !known.has(r.row.attachment!.id));
  if (!apply) back(`dry=1&line=${encodeURIComponent(dryRunLine(plan))}&reviewNew=${newReviews.length}`);
  let stored = 0, failed = 0, reviewed = 0;
  await inBatches(plan.store, 4, async ({ row, membershipId }) => {
    const bytes = await download(row);
    if (!Buffer.isBuffer(bytes)) { failed++; console.error("[headshots] a photo was not stored", JSON.stringify({ record: row.recordId, why: bytes.error })); return; }
    const s = await storeHeadshot(v.workspace.id, membershipId, bytes);
    if ("error" in s) { failed++; console.error("[headshots] a photo was not stored", JSON.stringify({ record: row.recordId, why: s.error })); return; }
    // Read again at write time: a member who uploaded their own a moment ago keeps it.
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
    if (!m || m.headshotSource === "upload" || m.headshotSource === "removed") return;
    await setMemberHeadshot(m, s, "import", row.attachment!.id);
    stored++;
  });
  await inBatches(newReviews, 4, async ({ row, reason, candidates }) => {
    const bytes = await download(row);
    const s = Buffer.isBuffer(bytes) ? await storeHeadshot(v.workspace.id, "review", bytes) : bytes;
    if ("error" in s) { failed++; console.error("[headshots] a review photo was not stored", JSON.stringify({ record: row.recordId, why: s.error })); return; }
    await db.insert(schema.headshotReviews).values({ id: newId(), workspaceId: v.workspace.id, airtableRecordId: row.recordId, attachmentId: row.attachment!.id, name: row.name.slice(0, 120), email: row.email, reason, candidates, photoUrl: s.url, displayUrl: s.displayUrl, mime: s.mime }).onConflictDoNothing();
    reviewed++;
  });
  refresh();
  back(`applied=1&matched=${matchedCount(plan)}&stored=${stored}&unchanged=${plan.unchanged.length}&kept=${plan.kept.length}&review=${reviewed}&noHeadshot=${plan.noHeadshot}&failed=${failed}`);
}

/** The coach picks the client for a review row: the photo becomes that client's, unless they uploaded or removed their own. */
export async function pickHeadshotAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) back(`error=${encodeURIComponent("Switch back to your own HelixOS first.")}`);
  const r = await db.query.headshotReviews.findFirst({ where: and(eq(schema.headshotReviews.id, str(formData, "id")), eq(schema.headshotReviews.workspaceId, v.workspace.id), eq(schema.headshotReviews.status, "open")) });
  if (!r || !r.photoUrl || !r.displayUrl) back(`error=${encodeURIComponent("That photo is no longer waiting.")}`);
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m) back(`error=${encodeURIComponent("Pick the client first.")}`);
  if (m!.headshotSource === "upload" || m!.headshotSource === "removed") back(`error=${encodeURIComponent("That client chose their own photo (or removed it). Theirs stands.")}`);
  // The photo's objects become the member's alone (erasing the member removes them); the row keeps only that it was settled.
  await setMemberHeadshot(m!, { url: r!.photoUrl!, displayUrl: r!.displayUrl!, mime: r!.mime ?? "image/jpeg" }, "import", r!.attachmentId);
  await db.update(schema.headshotReviews).set({ status: "picked", pickedMembershipId: m!.id, resolvedBy: v.user.id, photoUrl: null, displayUrl: null, name: "", email: null, candidates: [] }).where(and(eq(schema.headshotReviews.id, r!.id), eq(schema.headshotReviews.workspaceId, v.workspace.id)));
  refresh();
  back("picked=1");
}

/** The coach dismisses a review row: its photo leaves the store; a re-run never brings the same attachment back. */
export async function dismissHeadshotAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const r = await db.query.headshotReviews.findFirst({ where: and(eq(schema.headshotReviews.id, str(formData, "id")), eq(schema.headshotReviews.workspaceId, v.workspace.id), eq(schema.headshotReviews.status, "open")) });
  if (!r) back("dismissed=1");
  await db.update(schema.headshotReviews).set({ status: "dismissed", resolvedBy: v.user.id, photoUrl: null, displayUrl: null }).where(and(eq(schema.headshotReviews.id, r!.id), eq(schema.headshotReviews.workspaceId, v.workspace.id)));
  await dropReviewObjects(r!);
  refresh();
  back("dismissed=1");
}

/** The member removes their own photo (rule 5): both objects go and the import never puts it back. Their own, never while switched. */
export async function removeMyHeadshotAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "{first}'s photo is their own." });
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) });
  if (!m || m.id !== v.membership.id) return;
  await removeMemberHeadshot(m);
  refresh();
  redirect(`/settings?photo=removed#photo`);
}

