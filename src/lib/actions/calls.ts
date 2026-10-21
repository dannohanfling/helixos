"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { refresh, str } from "@/lib/action-helpers";
import { DEFAULT_CALLS, DEFAULT_CALLS_LINK, DEFAULT_CALLS_PASSCODE, readCall, readShared, readSkipDate } from "@/lib/engine/calls";

/**
 * Settings → Calls (H-820, plan H-828): the coach adds, edits, switches off and reorders the weekly calls, skips a date and
 * undoes it, and sets the shared link and passcode. Coach only; every call is checked against the coach's own workspace. A
 * refusal comes back as `?callsError=` with the field it names, so the form keeps what was typed.
 */
const back = (what: string, at = "calls") => `/settings?tab=coach&calls=${what}#${at}`;
/** `call` names the call whose form was refused (or "new"), so the card opens that form again with the typing put back. */
const refuse = (error: string, field?: string | null, at = "calls") => {
  const call = at.startsWith("call-") ? at.slice(5) : at === "calls-add" ? "new" : null;
  return `/settings?tab=coach&callsError=${encodeURIComponent(error)}${field ? `&field=${field}` : ""}${call ? `&call=${call}` : ""}#${at}`;
};

async function ownCall(workspaceId: string, callId: string) {
  return db.query.programCalls.findFirst({ where: and(eq(schema.programCalls.id, callId), eq(schema.programCalls.workspaceId, workspaceId)) });
}

/** The usual week, offered while the workspace has no calls yet; the shared link and passcode too, where unset. */
export async function addDefaultCallsAction(): Promise<void> {
  const coach = await requireCoach();
  const ws = coach.workspace;
  const any = await db.query.programCalls.findFirst({ where: eq(schema.programCalls.workspaceId, ws.id), columns: { id: true } });
  if (!any) await db.insert(schema.programCalls).values(DEFAULT_CALLS.map((c) => ({ id: newId(), workspaceId: ws.id, ...c, link: null, active: true })));
  if (!ws.callsLink && !ws.callsPasscode) await db.update(schema.workspaces).set({ callsLink: DEFAULT_CALLS_LINK, callsPasscode: DEFAULT_CALLS_PASSCODE }).where(eq(schema.workspaces.id, ws.id));
  refresh();
  redirect(back("added"));
}

/** One call, new (no callId) or edited. A new call goes to the end of the list, switched on. */
export async function saveCallAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const callId = str(formData, "callId");
  const at = callId ? `call-${callId}` : "calls-add";
  const read = readCall({ name: str(formData, "name"), weekday: str(formData, "weekday"), start: str(formData, "start"), minutes: str(formData, "minutes"), timezone: str(formData, "timezone"), audience: str(formData, "audience"), link: str(formData, "link") });
  if ("error" in read) redirect(refuse(read.error, read.field, at));
  if (callId) {
    if (!(await ownCall(coach.workspace.id, callId))) redirect(refuse("That call isn't on your schedule any more."));
    await db.update(schema.programCalls).set(read.value).where(and(eq(schema.programCalls.id, callId), eq(schema.programCalls.workspaceId, coach.workspace.id)));
  } else {
    const all = await db.query.programCalls.findMany({ where: eq(schema.programCalls.workspaceId, coach.workspace.id), columns: { sort: true } });
    await db.insert(schema.programCalls).values({ id: newId(), workspaceId: coach.workspace.id, ...read.value, active: true, sort: all.reduce((m, c) => Math.max(m, c.sort + 1), 0) });
  }
  refresh();
  redirect(back(callId ? "saved" : "added", at));
}

/** Switch a call off (members stop seeing it; its row and skips stay) or back on. */
export async function setCallActiveAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const callId = str(formData, "callId");
  if (!(await ownCall(coach.workspace.id, callId))) redirect(refuse("That call isn't on your schedule any more."));
  await db.update(schema.programCalls).set({ active: str(formData, "active") === "1" }).where(and(eq(schema.programCalls.id, callId), eq(schema.programCalls.workspaceId, coach.workspace.id)));
  refresh();
  redirect(back("saved", `call-${callId}`));
}

/** Move a call one place up or down the coach's list. */
export async function moveCallAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const callId = str(formData, "callId");
  const all = await db.query.programCalls.findMany({ where: eq(schema.programCalls.workspaceId, coach.workspace.id), orderBy: [asc(schema.programCalls.sort), asc(schema.programCalls.createdAt)], columns: { id: true } });
  const i = all.findIndex((c) => c.id === callId);
  const j = str(formData, "dir") === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < all.length) {
    const order = all.map((c) => c.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [n, id] of order.entries()) await db.update(schema.programCalls).set({ sort: n }).where(and(eq(schema.programCalls.id, id), eq(schema.programCalls.workspaceId, coach.workspace.id)));
  }
  refresh();
  redirect(back("moved", `call-${callId}`));
}

/** No call on one date ("No call on Thu 27 Nov"), with an optional note. Skipping a date twice changes nothing. */
export async function skipCallDateAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const workspaceId = coach.workspace.id;
  const callId = str(formData, "callId");
  const call = await ownCall(workspaceId, callId);
  if (!call) redirect(refuse("That call isn't on your schedule any more."));
  const day = readSkipDate(str(formData, "date"), call);
  if ("error" in day) redirect(refuse(day.error, "date", `call-${callId}`));
  const note = str(formData, "note").slice(0, 80) || null;
  await db.insert(schema.programCallSkips).values({ id: newId(), callId, date: day.value, note }).onConflictDoNothing();
  refresh();
  redirect(back("skipped", `call-${callId}`));
}

/** Undo a skip: the call is on that date again. */
export async function unskipCallAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const skipId = str(formData, "skipId");
  const own = db.select({ id: schema.programCalls.id }).from(schema.programCalls).where(eq(schema.programCalls.workspaceId, coach.workspace.id));
  const skip = await db.query.programCallSkips.findFirst({ where: and(eq(schema.programCallSkips.id, skipId), inArray(schema.programCallSkips.callId, own)) });
  if (skip) await db.delete(schema.programCallSkips).where(eq(schema.programCallSkips.id, skip.id));
  refresh();
  redirect(back("unskipped", skip ? `call-${skip.callId}` : "calls"));
}

/** The shared link (every call without its own) and the passcode members see beside Join. */
export async function saveCallsSharedAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const read = readShared({ link: str(formData, "link"), passcode: str(formData, "passcode") });
  if ("error" in read) redirect(refuse(read.error, read.field, "calls-shared"));
  await db.update(schema.workspaces).set(read.value).where(eq(schema.workspaces.id, coach.workspace.id));
  refresh();
  redirect(back("shared", "calls-shared"));
}
