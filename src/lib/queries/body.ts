/**
 * Body reads. Every read of a Body table in the app is here (a unit test holds that), and every read of someone else's Body data
 * goes through bodyAccess first: a coach sees a client's Body only while the client's share switch is on (rev 179, privacy).
 */
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { addDays, todayInTz } from "@/lib/dates";
import { MACROS, bodyAccessFor, bodyAiAllowedFor, capUse, dayMarks, dayTypeIdFor, formatBodyForAi, hasBands, nextRefeed, portionMacros, sumMacros, summaryLine, whatFits, worstMark, type BodyAccess, type Bands, type Macro, type Macros } from "@/lib/engine/body";

/**
 * Body ships dark (rev 195): a member whose Body is off gets a 404 from every Body page and from the Body export, as if Body did
 * not exist. Every Body page calls this first (a unit test holds that).
 */
export function requireBodyEnabled(v: Viewer): void {
  if (!v.membership.bodyEnabled) notFound();
}

/**
 * The workspace owner: its earliest coach membership still active (HelixOS has no owner column; the coach who set the workspace up
 * comes first). Only they get the "Show Body (beta) for me" switch on Settings (rev 209, item 4).
 */
export async function workspaceOwnerId(workspaceId: string): Promise<string | null> {
  const first = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "coach"), isNull(schema.memberships.removedAt)),
    orderBy: [asc(schema.memberships.createdAt), asc(schema.memberships.id)],
  });
  return first?.id ?? null;
}
export const isWorkspaceOwner = async (v: Viewer): Promise<boolean> => v.role === "coach" && (await workspaceOwnerId(v.workspace.id)) === v.membership.id;

export async function bodySettingsFor(workspaceId: string, userId: string): Promise<schema.BodySettings | null> {
  return (await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, workspaceId), eq(schema.bodySettings.userId, userId)) })) ?? null;
}

/**
 * May this viewer read this member's Body data, and as whom. The member is named by user id; their membership must be in the
 * viewer's workspace. Null means no: the caller shows nothing, not even whether there is anything.
 */
export async function bodyAccess(v: Viewer, memberUserId: string): Promise<BodyAccess> {
  if (memberUserId === v.user.id) return v.membership.bodyEnabled ? "self" : null;
  if (v.role !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, memberUserId)) });
  const s = m?.bodyEnabled ? await bodySettingsFor(v.workspace.id, memberUserId) : null;
  return bodyAccessFor({ viewerUserId: v.user.id, viewerRole: v.role, viewerWorkspaceId: v.workspace.id, memberUserId, memberWorkspaceId: m?.workspaceId ?? null, memberRemoved: !!m?.removedAt, memberEnabled: !!m?.bodyEnabled, shared: !!s?.shareWithCoach });
}

/**
 * A coach's view of a client's Body, by membership id. Null when there is no such client here or their Body is switched off (the
 * page is a 404, as if Body did not exist); "private" while they don't share; their user id, name and today while they do.
 */
export async function sharedClient(v: Viewer, membershipId: string): Promise<null | { shared: false } | { shared: true; userId: string; name: string; today: string }> {
  if (v.role !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || !m.bodyEnabled) return null;
  if ((await bodyAccess(v, m.userId)) !== "coach") return { shared: false };
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  // The client's own day, in their timezone, so "today" on the coach's view is the client's today.
  return { shared: true, userId: m.userId, name: u?.name ?? "Client", today: todayInTz(m.timezone || v.workspace.timezone) };
}

/** A day type's bands: only the macros the member has entered both ends for. A blank day type has none. */
export function bandsOf(t: schema.BodyDayType): Bands {
  const pairs: Record<Macro, [number | null, number | null]> = { cal: [t.calMin, t.calMax], p: [t.pMin, t.pMax], f: [t.fMin, t.fMax], c: [t.cMin, t.cMax] };
  const out: Bands = {};
  for (const m of MACROS) {
    const [min, max] = pairs[m];
    if (min !== null && max !== null) out[m] = { min, max };
  }
  return out;
}

export async function dayTypesFor(workspaceId: string, userId: string) {
  return db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)), orderBy: [asc(schema.bodyDayTypes.order), asc(schema.bodyDayTypes.createdAt)] });
}

export type MealWithTotals = schema.BodyMeal & { totals: Macros; lines: { food: schema.BodyFood; qty: number }[]; missing: number };

/** The member's library: foods, and saved meals with their totals worked out from the foods as they are now. */
export async function bodyLibrary(workspaceId: string, userId: string, opts: { archived?: boolean } = {}) {
  const [foods, meals] = await Promise.all([
    db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId), opts.archived ? undefined : isNull(schema.bodyFoods.archivedAt)), orderBy: asc(schema.bodyFoods.name) }),
    db.query.bodyMeals.findMany({ where: and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId), opts.archived ? undefined : isNull(schema.bodyMeals.archivedAt)), orderBy: asc(schema.bodyMeals.name) }),
  ]);
  // An archived food still counts in a meal that uses it: archiving hides it from the picker, it doesn't break a meal.
  const allFoods = opts.archived ? foods : await db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)) });
  const byId = new Map(allFoods.map((f) => [f.id, f]));
  const withTotals: MealWithTotals[] = meals.map((m) => {
    const lines = m.items.flatMap((i) => (byId.has(i.foodId) ? [{ food: byId.get(i.foodId)!, qty: i.qty }] : []));
    return { ...m, lines, missing: m.items.length - lines.length, totals: sumMacros(lines.map((l) => portionMacros({ ...l.food, qty: l.qty }))) };
  });
  return { foods, meals: withTotals };
}

/** Everything one day's page needs: its day type and bands, what was eaten, the marks, what's left, what fits, caps, comments. */
export async function bodyDay(workspaceId: string, userId: string, date: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [dayTypes, entries, override, comments, library, anyEntry] = await Promise.all([
    dayTypesFor(workspaceId, userId),
    db.query.bodyEntries.findMany({ where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), eq(schema.bodyEntries.date, date)), orderBy: asc(schema.bodyEntries.createdAt) }),
    db.query.bodyDays.findFirst({ where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), eq(schema.bodyDays.date, date)) }),
    db.query.bodyComments.findMany({ where: and(eq(schema.bodyComments.workspaceId, workspaceId), eq(schema.bodyComments.userId, userId), eq(schema.bodyComments.date, date)), orderBy: asc(schema.bodyComments.createdAt) }),
    bodyLibrary(workspaceId, userId),
    db.query.bodyEntries.findFirst({ columns: { id: true }, where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId)) }),
  ]);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const typeId = dayTypeIdFor(date, settings.weekPattern, refeed, override?.dayTypeId ?? null);
  const dayType = dayTypes.find((t) => t.id === typeId) ?? null;
  const totals = sumMacros(entries.map((e) => ({ cal: e.cal, p: e.p, f: e.f, c: e.c })));
  const floors = { cal: settings.calFloor, f: settings.fatFloor };
  const final = date < today;
  // No bands yet (a blank start): totals only, no marks, nothing left to show and nothing to fit.
  const typeBands = dayType ? bandsOf(dayType) : null;
  const bands = hasBands(typeBands) ? typeBands : null;
  const marks = bands ? dayMarks(totals, bands, { floors, overOk: settings.overOk, final }) : null;
  const left = bands ? Object.fromEntries(MACROS.flatMap((m) => (bands[m] ? [[m, { min: bands[m]!.min - totals[m], max: bands[m]!.max - totals[m] }]] : []))) as Partial<Record<Macro, { min: number; max: number }>> : null;
  const fits = bands ? whatFits(totals, bands, library.meals.filter((m) => !m.missing), { floors, overOk: settings.overOk }) : [];
  // The fill-in checklist (rev 192): shown at the top of /body until targets, a food and a first logged meal exist.
  const checklist = { ai: !!settings.aiAskedAt, targets: dayTypes.some((t) => hasBands(bandsOf(t))), dayTypes: dayTypes.length > 1, foods: library.foods.length > 0, meals: library.meals.length > 0, logged: !!anyEntry };
  const caps = capUse(settings.caps, entries.flatMap((e) => e.items.map((i) => ({ capTag: i.capTag, qty: i.qty }))));
  const authors = comments.length ? await db.query.users.findMany({ columns: { id: true, name: true }, where: inArray(schema.users.id, [...new Set(comments.map((c) => c.authorUserId))]) }) : [];
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  return {
    settings,
    dayTypes,
    dayType,
    overridden: !!override?.dayTypeId,
    entries,
    totals,
    bands,
    marks,
    worst: marks ? worstMark(marks) : null,
    left,
    fits,
    caps,
    final,
    nextRefeed: nextRefeed(today, refeed),
    comments: comments.map((c) => ({ ...c, author: authorName.get(c.authorUserId) ?? "Coach" })),
    library,
    checklist,
  };
}
export type BodyDayView = NonNullable<Awaited<ReturnType<typeof bodyDay>>>;

/** Today's one line: "Lift day · 780 of 1,400–1,500 cal · 110 of 180–200 P". Null until today's day type has targets (rev 192). */
export async function todayBody(v: Viewer) {
  if (!v.membership.bodyEnabled) return null;
  const d = await bodyDay(v.workspace.id, v.user.id, v.today, v.today);
  if (!d?.bands) return null;
  return { dayType: d.dayType?.name ?? null, line: summaryLine(d.totals, d.bands, d.marks), reminder: d.dayType?.reminder ?? null };
}

/** The last days with anything logged, newest first, for the recent strip: date, totals and the worst mark. */
export async function recentDays(workspaceId: string, userId: string, today: string, days = 7) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return [];
  const from = addDays(today, -(days - 1));
  const [entries, types, overrides] = await Promise.all([
    db.query.bodyEntries.findMany({ where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), gte(schema.bodyEntries.date, from)), orderBy: desc(schema.bodyEntries.date) }),
    dayTypesFor(workspaceId, userId),
    db.query.bodyDays.findMany({ where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), gte(schema.bodyDays.date, from)) }),
  ]);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const out = [];
  for (let d = today; d >= from; d = addDays(d, -1)) {
    const list = entries.filter((e) => e.date === d);
    const typeId = dayTypeIdFor(d, settings.weekPattern, refeed, overrides.find((o) => o.date === d)?.dayTypeId ?? null);
    const t = types.find((x) => x.id === typeId) ?? null;
    const totals = sumMacros(list.map((e) => ({ cal: e.cal, p: e.p, f: e.f, c: e.c })));
    const bands = t ? bandsOf(t) : null;
    const marks = hasBands(bands) && list.length ? dayMarks(totals, bands, { floors: { cal: settings.calFloor, f: settings.fatFloor }, overOk: settings.overOk, final: d < today }) : null;
    out.push({ date: d, dayType: t?.name ?? null, logged: list.length, totals, worst: marks ? worstMark(marks) : null });
  }
  return out;
}

/**
 * The one check every AI prompt that could include Body data goes through (rev 219). Read fresh on every call, so switching it off
 * stops it on the very next request. Only the member's own session: a coach, or a coach switched into the client's HelixOS, never.
 */
export async function canAiUseBody(v: Viewer, memberUserId: string): Promise<boolean> {
  if (memberUserId !== v.user.id) return false;
  const s = await bodySettingsFor(v.workspace.id, memberUserId);
  return bodyAiAllowedFor({ viewerUserId: v.user.id, memberUserId, memberEnabled: v.membership.bodyEnabled, aiUse: !!s?.aiUse });
}

/**
 * The member's Body data as a short block of numbers and text for an AI prompt, or null when AI may not use it. The only way Body
 * data reaches AI (a unit test holds that): targets, the last 7 days' totals, today's logged foods and meals, saved meal names.
 * Never photos, private notes or a coach's comments.
 */
export async function bodyAiContext(v: Viewer): Promise<string | null> {
  if (!(await canAiUseBody(v, v.user.id))) return null;
  const [d, recent, types] = await Promise.all([bodyDay(v.workspace.id, v.user.id, v.today, v.today), recentDays(v.workspace.id, v.user.id, v.today), dayTypesFor(v.workspace.id, v.user.id)]);
  if (!d) return null;
  return formatBodyForAi({
    today: v.today,
    dayTypes: types.map((t) => ({ name: t.name, bands: bandsOf(t) })),
    days: recent.map((r) => ({ date: r.date, dayType: r.dayType, totals: r.totals, logged: r.logged })),
    todayEntries: d.entries.map((e) => ({ slot: e.slot, name: e.name, items: e.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })), totals: { cal: e.cal, p: e.p, f: e.f, c: e.c } })),
    meals: d.library.meals.map((m) => m.name),
  });
}

export async function shareHistory(workspaceId: string, userId: string) {
  return db.query.bodyShareEvents.findMany({ where: and(eq(schema.bodyShareEvents.workspaceId, workspaceId), eq(schema.bodyShareEvents.userId, userId)), orderBy: desc(schema.bodyShareEvents.createdAt), limit: 20 });
}

/** The coach's client page: whether this client shares Body, and if so the last week's one-line summary. Nothing when private. */
export async function coachBodySummary(v: Viewer, memberUserId: string, today: string) {
  if ((await bodyAccess(v, memberUserId)) !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, memberUserId)) });
  return { membershipId: m!.id, days: await recentDays(v.workspace.id, memberUserId, today) };
}

