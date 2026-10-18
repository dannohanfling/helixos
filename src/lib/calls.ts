/**
 * The weekly calls (H-820, plan H-828), the server side: the reads the /calls page, the Next call line on Today, the Add to
 * calendar route and the coach's Settings → Calls card share. The rules are in src/lib/engine/calls.ts.
 *
 * `callsBetween` is the source for the H-771 reminders (morning of, 15 minutes before, and "we're live", which goes at the
 * start, `startIso`): every occurrence of the workspace's active calls in a window, skipped dates left out, with how to join.
 * The sender passes each member's level as `seer`, so the calls and their live ends are that member's; nothing here reads members.
 */
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, todayInTz } from "@/lib/dates";
import { callOccurrences, type CallOccurrence, type CallSeer } from "@/lib/engine/calls";

export type CallsWorkspace = { id: string; callsLink: string | null; callsPasscode: string | null };

/**
 * Every occurrence of the workspace's active calls that is on during [from, to) (start to live end), sorted by start, each with
 * its link (the call's own, else the shared one) and the workspace's passcode. With `seer`, only the calls that member can
 * see, and a live end cut by the next call they can see (H-836). One query: the calls, their skips from just before the
 * window on, and the workspace's link, joined.
 */
export async function callsBetween(workspaceId: string, from: Date | string, to: Date | string, seer?: CallSeer): Promise<CallOccurrence<schema.ProgramCall>[]> {
  // A skip is a call's own local date; two days before the window's UTC date covers every zone.
  const since = addDays(todayInTz("UTC", new Date(from)), -2);
  const rows = await db
    .select({ call: schema.programCalls, skip: schema.programCallSkips, link: schema.workspaces.callsLink, passcode: schema.workspaces.callsPasscode })
    .from(schema.programCalls)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.programCalls.workspaceId))
    .leftJoin(schema.programCallSkips, and(eq(schema.programCallSkips.callId, schema.programCalls.id), gte(schema.programCallSkips.date, since)))
    .where(and(eq(schema.programCalls.workspaceId, workspaceId), eq(schema.programCalls.active, true)));
  if (!rows.length) return [];
  const calls = new Map(rows.map((r) => [r.call.id, r.call]));
  const skips = rows.flatMap((r) => (r.skip ? [{ callId: r.skip.callId, date: r.skip.date }] : []));
  return callOccurrences([...calls.values()], skips, from, to, { link: rows[0].link, passcode: rows[0].passcode }, seer);
}

/** Every call of the workspace, on or off, in the coach's order, with its skips from `since` on (the coach's card). */
export async function callsWithSkips(workspaceId: string, since: string) {
  const calls = await db.query.programCalls.findMany({ where: eq(schema.programCalls.workspaceId, workspaceId), orderBy: [asc(schema.programCalls.sort), asc(schema.programCalls.createdAt)] });
  const skips = calls.length ? await db.query.programCallSkips.findMany({ where: and(inArray(schema.programCallSkips.callId, calls.map((c) => c.id)), gte(schema.programCallSkips.date, since)), orderBy: [asc(schema.programCallSkips.date)] }) : [];
  return calls.map((c) => ({ call: c, skips: skips.filter((s) => s.callId === c.id) }));
}

/** One call of the workspace, with all its skips (the calendar file), or null. */
export async function callWithSkips(workspaceId: string, callId: string) {
  const call = await db.query.programCalls.findFirst({ where: and(eq(schema.programCalls.id, callId), eq(schema.programCalls.workspaceId, workspaceId)) });
  if (!call) return null;
  const skips = await db.query.programCallSkips.findMany({ where: eq(schema.programCallSkips.callId, call.id) });
  return { call, skips };
}
