"use server";

/**
 * Body writes (rev 179). Every write is the signed-in member's own, keyed by their workspace and user id, except a coach's day
 * comment, which needs the member's share switch on at the moment it's written. No Body value is ever logged.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { requireCoach, type Viewer } from "@/lib/auth";
import { MACROS, entryItem, totalsOf, type Macro } from "@/lib/engine/body";
import { newId } from "@/lib/ids";
import { amountIn, convertQty, storedUnit } from "@/lib/engine/body-units";
import { decodeFound, foodFromFound, gapNote } from "@/lib/engine/body-find";
import { photoItems, readPhotoLines, type PhotoLine } from "@/lib/engine/body-photo";
import { IMAGE_MAX_BYTES, isImageType } from "@/lib/engine/ai-request";
import { readPlate, summariseWeek } from "@/lib/body-ai";
import { isDayFlag } from "@/lib/engine/body-flags";
import { weekNumbers } from "@/lib/engine/body-week";
import { habitShown, isMeasures, measuresFromZone, storedFromShown, unitsFor, type Measures } from "@/lib/engine/body-measures";
import { MED_TYPES, WITH_FOOD, expiryFrom, fillBoxes, refill, takesFromBottle, type MedType, type WithFood } from "@/lib/engine/body-meds";
import { checkinNote, checkinWeekOk, copyName, dayTypeTemplate, isTemplateKind, mealTemplate, routineTemplate, sameName, templateName, type TemplatePayload } from "@/lib/engine/body-templates";
import { bodyWeek } from "@/lib/queries/body";
import { toBasis, yieldFor } from "@/lib/engine/body-pantry";
import { consumePantry } from "@/lib/body-pantry";
import { AirtableError, airtableProblem } from "@/lib/airtable";
import { applyHistory, existingHistory, readHumanos } from "@/lib/body-import";
import { buildHistoryPlan, historySummary, type Existing, type HistoryPlan, type HistorySummary } from "@/lib/engine/body-airtable";
import { allow } from "@/lib/rate-limit";
import { daysFrom } from "@/lib/engine/body-habits";
import { parseHours, recoveryInRange, sleepReadingId } from "@/lib/engine/body-recovery";
import { instacartLines } from "@/lib/engine/body-shopping";
import { INSTACART_OPEN, INSTACART_SOON_LINE, InstacartError, createShoppingListLink, instacartProblem } from "@/lib/instacart";
import { shoppingView } from "@/lib/queries/body";
import { disconnectWhoop, syncWhoop } from "@/lib/body-whoop";
import { syncWords } from "@/lib/engine/body-whoop";
import { WhoopError, whoopProblem } from "@/lib/whoop";
import { METRIC, METRIC_KEYS, inRange, parseScaleCsv, readTime, storedValue, type MetricKey } from "@/lib/engine/body-scale";
import { addDays, daysBetween, nowIso, startOfWeek, weekday } from "@/lib/dates";
import { bodyAccess, bodySettingsFor } from "@/lib/queries/body";
import { saveReadings } from "@/lib/body-readings";
import { saveNextWeight } from "@/lib/body-next";
import { mergeExercises, undoMerge } from "@/lib/body-merge";
import { makeHealthKey, revokeHealthKey } from "@/lib/body-health";
import { archiveGoal, goalKey, logWaist, setGoal } from "@/lib/body-goals";
import { storedTarget } from "@/lib/engine/body-goals";
import { logSync } from "@/lib/integrations";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A refusal: back to `path` with the reason, naming the box to fix when there is one, so only that box is marked (rev 444). */
const back = (path: string, error: string, field?: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}${field ? `&field=${encodeURIComponent(field)}` : ""}`);

/**
 * The HumanOS page a form was sent from, for a refusal that doesn't know it (rev 444): the address the browser names, kept only
 * when it is a HumanOS page, with any earlier answer taken off it. Anything else goes to `fallback`.
 */
async function sentFrom(fallback: string): Promise<string> {
  try {
    const u = new URL((await headers()).get("referer") ?? "");
    if (!/^\/body(\/|$)/.test(u.pathname)) return fallback;
    for (const k of ["error", "field", "said", "logged"]) u.searchParams.delete(k);
    return `${u.pathname}${u.search}`;
  } catch {
    return fallback;
  }
}

/**
 * A save that lands after a refusal leaves the page without the refusal (rev 444). Body's saves mostly answer in place, so the
 * address would keep the earlier "?error=…" and the shared SubmitButton would read it as this save refused, putting back the
 * typing it just saved. Only a HumanOS page that still names an error is sent anywhere.
 */
async function settle(): Promise<void> {
  let ref: URL;
  try {
    ref = new URL((await headers()).get("referer") ?? "");
  } catch {
    return;
  }
  if (!/^\/body(\/|$)/.test(ref.pathname) || ![...ref.searchParams.keys()].some((k) => /error$/i.test(k))) return;
  redirect(await sentFrom(ref.pathname));
}

/**
 * A number from a box, read the way people write it (rev 444): "1.5k", "2,5", "154 lb" in a kg box (converted to `to`), "30
 * tablets". Blank is null. Anything it can't read goes back to the page the form was on, with what was typed put back and only
 * that box marked; nothing unreadable is ever saved as 0.
 */
async function amount(fd: FormData, key: string, to?: string | null, fallback = "/body"): Promise<number | null> {
  const r = amountIn(str(fd, key), to);
  if (r != null && typeof r === "object") back(await sentFrom(fallback), r.error, key);
  return r as number | null;
}

/** Body ships dark (rev 195): a member whose Body is off writes nothing, whatever reaches the action. */
function enabled(v: Viewer): void {
  if (!v.membership.bodyEnabled) redirect("/today");
}

/** The member's Body settings; no settings yet means Body isn't set up, so the write goes nowhere and the page offers setup. */
async function setUp(v: Viewer): Promise<schema.BodySettings> {
  enabled(v);
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) redirect("/body");
  return settings;
}

/* ───────── The HumanOS switch (rev 320/322) ───────── */

/** Every on and off of HumanOS itself is a share-events row of kind humanos: who it was for, and who flipped it, in the note. */
async function logHumanos(workspaceId: string, userId: string, on: boolean, by: "member" | "coach", coachName?: string | null): Promise<void> {
  await db.insert(schema.bodyShareEvents).values({ id: newId(), workspaceId, userId, shared: on, kind: "humanos" });
  await logSync({ workspaceId, userId, provider: "account", direction: "in", event: on ? "humanos.on" : "humanos.off", status: "received", note: by === "member" ? `HumanOS switched ${on ? "on" : "off"} by the member on Settings` : `HumanOS switched on by their coach${coachName ? ` (${coachName})` : ""} on the coach view` });
}

/**
 * "Turn on HumanOS" (rev 320/322): any member, for their own membership only, from Settings. Off hides the group and keeps every
 * row; on shows it as it was. Never from a switched-in coach (the client's own choice), and never for anyone else. Not behind
 * the HumanOS flag: it is the flag. The two consent switches (coach sharing, AI use) are untouched either way.
 */
export async function setHumanosAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is the client's own switch. They turn it on from their Settings, or you can from the coach view when they've given you working access." });
  const on = str(formData, "on") === "1";
  if (on === v.membership.bodyEnabled) return refresh();
  await db.update(schema.memberships).set({ bodyEnabled: on }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, v.user.id)));
  await logHumanos(v.workspace.id, v.user.id, on, "member");
  refresh();
  await settle();
}

/**
 * The coach's path (Danno, rev 322): a coach turns HumanOS on for a client in their own workspace, only while that client's
 * "Let my coach work in my HelixOS" is on; never off (that stays the client's), never for a removed client, never from a
 * switched-in session. Turning it on shares nothing: the client's coach-sharing and AI switches stay where they were.
 */
export async function setClientHumanosAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) redirect("/coach");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || m.role !== "client" || m.removedAt || !m.coachCanWork) redirect("/coach?error=" + encodeURIComponent("HumanOS can be switched on only for a client who has given you working access."));
  if (m!.bodyEnabled) return refresh();
  await db.update(schema.memberships).set({ bodyEnabled: true }).where(and(eq(schema.memberships.id, m!.id), eq(schema.memberships.workspaceId, v.workspace.id)));
  await logHumanos(v.workspace.id, m!.userId, true, "coach", v.user.name);
  refresh();
  await settle();
}

/* ───────── B9: coach templates and the weekly check-in ───────── */

const ownRows = <T extends { workspaceId: unknown; userId: unknown }>(t: T, workspaceId: string, userId: string) => and(eq(t.workspaceId as never, workspaceId), eq(t.userId as never, userId));

/**
 * A coach sends one of their own day types, meals or routines to a client, as a snapshot (B9a, rev 353). Only the coach's own rows
 * are read; nothing of the client's. The client decides on their own page; a client whose HumanOS is off holds it until it's on.
 */
export async function sendTemplateAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (v.switchedInto) redirect("/coach");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, str(formData, "membershipId")), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || m.role !== "client" || m.removedAt) redirect("/coach");
  const where = `/coach/${m.id}`;
  const [kind, id] = (opt(formData, "pick") ?? `${opt(formData, "kind") ?? ""}:${opt(formData, "id") ?? ""}`).split(":");
  if (!isTemplateKind(kind) || !id) back(where, "Pick a day type, a meal or a routine to send.");
  if (!(await bodySettingsFor(v.workspace.id, v.user.id))) back(where, "Set up your own HumanOS first: a template is one of your own day types, meals or routines.");
  const ws = v.workspace.id;
  let payload: TemplatePayload | null = null;
  if (kind === "day_type") {
    const t = await db.query.bodyDayTypes.findFirst({ where: and(eq(schema.bodyDayTypes.id, id), ownRows(schema.bodyDayTypes, ws, v.user.id)) });
    payload = t ? dayTypeTemplate(t) : null;
  } else if (kind === "meal") {
    const meal = await db.query.bodyMeals.findFirst({ where: and(eq(schema.bodyMeals.id, id), ownRows(schema.bodyMeals, ws, v.user.id)) });
    payload = meal && !meal.archivedAt ? mealTemplate(meal, await db.query.bodyFoods.findMany({ where: ownRows(schema.bodyFoods, ws, v.user.id) })) : null;
  } else {
    const r = await db.query.bodyRoutines.findFirst({ where: and(eq(schema.bodyRoutines.id, id), ownRows(schema.bodyRoutines, ws, v.user.id)) });
    payload = r && !r.archivedAt ? routineTemplate(r, await db.query.bodyExercises.findMany({ where: ownRows(schema.bodyExercises, ws, v.user.id) })) : null;
  }
  if (!payload) back(where, "That one isn't yours to send, or it's empty.");
  await db.insert(schema.bodyTemplateSends).values({ id: newId(), workspaceId: ws, userId: m.userId, coachUserId: v.user.id, coachName: v.user.name, kind: payload!.kind, name: templateName(payload!), payload: payload! as unknown as Record<string, unknown> });
  refresh();
  redirect(`${where}?template=sent#templates`);
}

/** The client takes a template as their own copy (foods and exercises made by name where missing) or declines it. */
export async function decideTemplateAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const backTo = (() => {
    const b = opt(formData, "back") ?? "/body";
    return b.startsWith("/body") && !b.includes("//") ? b : "/body";
  })();
  const send = await db.query.bodyTemplateSends.findFirst({ where: and(eq(schema.bodyTemplateSends.id, str(formData, "id")), ownRows(schema.bodyTemplateSends, workspaceId, userId)) });
  if (!send || send.status !== "sent") back(backTo, "That template isn't waiting on you any more.");
  const decision = str(formData, "decision");
  if (decision !== "accept") {
    await db.update(schema.bodyTemplateSends).set({ status: "declined", decidedAt: nowIso() }).where(eq(schema.bodyTemplateSends.id, send!.id));
    refresh();
    redirect(backTo);
  }
  const p = send!.payload as unknown as TemplatePayload;
  if (p.kind === "day_type") {
    const mine = await db.query.bodyDayTypes.findMany({ where: ownRows(schema.bodyDayTypes, workspaceId, userId) });
    if (mine.length >= 12) back(backTo, "Twelve day types is the most; remove one to take this one.");
    const { name, ...rest } = p.dayType;
    await db.insert(schema.bodyDayTypes).values({ id: newId(), workspaceId, userId, name: copyName(name, mine, send!.coachName), order: mine.length, ...rest });
  } else if (p.kind === "meal") {
    const foods = (await db.query.bodyFoods.findMany({ where: ownRows(schema.bodyFoods, workspaceId, userId) })).filter((f) => !f.archivedAt);
    const items: schema.BodyMealItem[] = [];
    for (const i of p.meal.items) {
      let f = sameName(i.food.name, foods);
      if (!f) {
        const id = newId();
        await db.insert(schema.bodyFoods).values({ id, workspaceId, userId, ...i.food });
        f = (await db.query.bodyFoods.findFirst({ where: eq(schema.bodyFoods.id, id) }))!;
        foods.push(f);
      }
      items.push({ foodId: f.id, qty: i.qty });
    }
    const meals = (await db.query.bodyMeals.findMany({ where: ownRows(schema.bodyMeals, workspaceId, userId) })).filter((m) => !m.archivedAt);
    await db.insert(schema.bodyMeals).values({ id: newId(), workspaceId, userId, name: copyName(p.meal.name, meals, send!.coachName), slot: p.meal.slot, items });
  } else {
    const exercises = (await db.query.bodyExercises.findMany({ where: ownRows(schema.bodyExercises, workspaceId, userId) })).filter((e) => !e.archivedAt);
    const items: schema.BodyRoutineItem[] = [];
    for (const i of p.routine.items) {
      let e = sameName(i.exercise.name, exercises);
      if (!e) {
        const id = newId();
        await db.insert(schema.bodyExercises).values({ id, workspaceId, userId, name: i.exercise.name, kind: i.exercise.kind });
        e = (await db.query.bodyExercises.findFirst({ where: eq(schema.bodyExercises.id, id) }))!;
        exercises.push(e);
      }
      items.push({ exerciseId: e.id, sets: i.sets, reps: i.reps });
    }
    const routines = (await db.query.bodyRoutines.findMany({ where: ownRows(schema.bodyRoutines, workspaceId, userId) })).filter((r) => !r.archivedAt);
    await db.insert(schema.bodyRoutines).values({ id: newId(), workspaceId, userId, name: copyName(p.routine.name, routines, send!.coachName), dayTypeId: null, items });
  }
  await db.update(schema.bodyTemplateSends).set({ status: "accepted", decidedAt: nowIso() }).where(eq(schema.bodyTemplateSends.id, send!.id));
  refresh();
  redirect(backTo);
}

/**
 * "Send this week to your coach" (B9b): the week's numbers as the lines the AI summary gets (never a food, a note, a photo or the
 * health log) plus one note, kept as a snapshot the coach reads with no sharing switch in the way. One a week; sending again replaces it.
 */
export async function sendCheckinAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const monday = str(formData, "monday");
  const where = `/body/week?week=${monday}`;
  if (!checkinWeekOk(monday, v.today, startOfWeek)) back("/body/week", "Pick a week that has started.");
  const w = await bodyWeek(workspaceId, userId, monday, v.today);
  if (!w) back(where, "Nothing to send yet.");
  const lines = weekNumbers({ label: `${w!.monday} to ${w!.sunday}`, nutrition: w!.nutrition, prevNutrition: w!.prevNutrition, training: w!.training, prevTraining: w!.prevTraining, weigh: { avg: w!.weigh.avg, days: w!.weigh.days }, prevWeigh: { avg: w!.weigh.prevAvg, days: 0 }, weightUnit: settings.weightUnit, sleepAvg: w!.sleep?.avg ?? null, burnAvg: w!.burn?.avg ?? null, habits: w!.habits ?? { due: 0, kept: 0 } }).split("\n");
  const note = checkinNote(opt(formData, "note") ?? "");
  await db.delete(schema.bodyCheckins).where(and(ownRows(schema.bodyCheckins, workspaceId, userId), eq(schema.bodyCheckins.monday, monday)));
  await db.insert(schema.bodyCheckins).values({ id: newId(), workspaceId, userId, monday, lines, note, sentAt: nowIso() });
  refresh();
  redirect(`${where}&checkin=sent#checkin`);
}

/** The member takes a sent check-in back; it goes for the coach too (rev 200). */
export async function deleteCheckinAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  await db.delete(schema.bodyCheckins).where(and(eq(schema.bodyCheckins.id, str(formData, "id")), ownRows(schema.bodyCheckins, workspaceId, userId)));
  refresh();
  await settle();
}

/* ───────── Setup ───────── */

/**
 * First visit: the blank skeleton (rev 192), the same for every member, Danno included. One day type, "Every day", with no bands
 * until the member enters them; the four common slots; no floors, caps, refeed, foods or meals. The member fills it in from the
 * checklist on /body. Once only.
 */
export async function setupBodyAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  enabled(v);
  if (await bodySettingsFor(workspaceId, userId)) redirect("/body");
  const everyDay = newId();
  await db.batch([
    db.insert(schema.bodySettings).values({ id: newId(), workspaceId, userId, measures: measuresFromZone(v.tz), ...unitsFor(measuresFromZone(v.tz)), weekPattern: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), everyDay])) }),
    db.insert(schema.bodyDayTypes).values({ id: everyDay, workspaceId, userId, name: "Every day", order: 0 }),
  ]);
  refresh();
  redirect("/body");
}

/* ───────── Settings ───────── */

export async function saveBodySettingsAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own consent to give, so it can't be changed from their HelixOS." });
  const settings = await setUp(v);
  const types = await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) });
  const typeIds = new Set(types.map((t) => t.id));
  const typeOrNull = (v: string) => (typeIds.has(v) ? v : null);
  const anchor = str(formData, "refeedAnchor");
  if (anchor && !DATE.test(anchor)) back("/body/settings", "The next refeed needs a date.");
  const every = Math.round((await amount(formData, "refeedEveryDays", null, "/body/settings")) ?? 0);
  const slots = str(formData, "mealSlots").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const caps: schema.BodyCap[] = [];
  for (let i = 0; i < 10; i++) {
    const tag = str(formData, `cap_${i}_tag`).toLowerCase();
    if (!tag) continue;
    const capUnit = str(formData, `cap_${i}_unit`) || "oz";
    const soft = (await amount(formData, `cap_${i}_soft`, capUnit, "/body/settings")) ?? 0;
    const hard = (await amount(formData, `cap_${i}_hard`, capUnit, "/body/settings")) ?? 0;
    if (hard < soft) back("/body/settings", `The ${tag} cap's flex top can't be under its default.`, `cap_${i}_hard`);
    caps.push({ tag, label: str(formData, `cap_${i}_label`) || tag, unit: capUnit, soft, hard, per: str(formData, `cap_${i}_per`) === "week" ? "week" : "day" });
  }
  await db
    .update(schema.bodySettings)
    .set({
      // One setting, Metric or US (rev 424); the weight and food units follow it.
      ...(() => {
        const measures: Measures = isMeasures(str(formData, "measures")) ? (str(formData, "measures") as Measures) : (settings.measures as Measures | null) ?? "us";
        return { measures, ...unitsFor(measures) };
      })(),
      calFloor: await amount(formData, "calFloor", null, "/body/settings"),
      fatFloor: await amount(formData, "fatFloor", "g", "/body/settings"),
      overOk: MACROS.filter((m) => formData.get(`overOk_${m}`) === "on") as Macro[],
      weekPattern: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), typeOrNull(str(formData, `pattern_${d}`))])),
      refeedDayTypeId: typeOrNull(str(formData, "refeedDayTypeId")),
      refeedAnchor: anchor || null,
      refeedEveryDays: every >= 1 && every <= 60 ? every : 14,
      mealSlots: slots.length ? slots : settings.mealSlots,
      caps,
      updatedAt: nowIso(),
    })
    .where(eq(schema.bodySettings.id, settings.id));
  refresh();
  await settle();
}

/** "Let my coach see my Body data": on or off, logged either way. */
export async function setBodyShareAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own consent to give, so it can't be changed from their HelixOS." });
  const settings = await setUp(v);
  const shared = str(formData, "shared") === "1";
  if (shared === settings.shareWithCoach) return refresh();
  await db.batch([
    db.update(schema.bodySettings).set({ shareWithCoach: shared, updatedAt: nowIso() }).where(eq(schema.bodySettings.id, settings.id)),
    db.insert(schema.bodyShareEvents).values({ id: newId(), workspaceId, userId, shared }),
  ]);
  refresh();
  await settle();
}

/** "Let AI use my Body data to support me" (rev 219): on or off, logged either way, independent of coach sharing. */
export async function setBodyAiAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own consent to give, so it can't be changed from their HelixOS." });
  const settings = await setUp(v);
  const on = str(formData, "on") === "1";
  // Yes or Not now on the checklist both answer the question; only a change of the switch itself is logged.
  const askedAt = settings.aiAskedAt ?? nowIso();
  if (on === settings.aiUse) {
    if (!settings.aiAskedAt) await db.update(schema.bodySettings).set({ aiAskedAt: askedAt }).where(eq(schema.bodySettings.id, settings.id));
    return refresh();
  }
  await db.batch([
    db.update(schema.bodySettings).set({ aiUse: on, aiAskedAt: askedAt, updatedAt: nowIso() }).where(eq(schema.bodySettings.id, settings.id)),
    db.insert(schema.bodyShareEvents).values({ id: newId(), workspaceId, userId, shared: on, kind: "ai" }),
  ]);
  refresh();
  await settle();
}

/* ───────── Day types ───────── */

export async function saveDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 60);
  if (!name) back("/body/settings", "A day type needs a name.");
  // A band is both ends or neither: a macro left blank has no band yet (shown as a total, unmarked).
  const bands = { calMin: await amount(formData, "calMin", null, "/body/settings"), calMax: await amount(formData, "calMax", null, "/body/settings"), pMin: await amount(formData, "pMin", "g", "/body/settings"), pMax: await amount(formData, "pMax", "g", "/body/settings"), fMin: await amount(formData, "fMin", "g", "/body/settings"), fMax: await amount(formData, "fMax", "g", "/body/settings"), cMin: await amount(formData, "cMin", "g", "/body/settings"), cMax: await amount(formData, "cMax", "g", "/body/settings") };
  for (const [lo, hi, label] of [["calMin", "calMax", "Calories"], ["pMin", "pMax", "Protein"], ["fMin", "fMax", "Fat"], ["cMin", "cMax", "Carbs"]] as const) {
    const a = bands[lo];
    const b = bands[hi];
    if ((a === null) !== (b === null)) back("/body/settings", `${name}: give ${label} both a from and a to, or leave both blank.`);
    if (a !== null && b !== null && (a < 0 || b < a)) back("/body/settings", `${name}: ${label}'s top can't be under its bottom.`);
  }
  const reminder = opt(formData, "reminder")?.slice(0, 140) ?? null;
  if (id) {
    await db.update(schema.bodyDayTypes).set({ name, reminder, ...bands }).where(and(eq(schema.bodyDayTypes.id, id), and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId))));
  } else {
    const count = (await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) })).length;
    if (count >= 12) back("/body/settings", "Twelve day types is the most.");
    await db.insert(schema.bodyDayTypes).values({ id: newId(), workspaceId, userId, name, reminder, order: count, ...bands });
  }
  refresh();
  await settle();
}

/** A day type goes; days set to it fall back to the pattern, and the pattern and refeed rule forget it. The last one stays. */
export async function deleteDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const id = str(formData, "id");
  const types = await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) });
  if (!types.some((t) => t.id === id)) return;
  if (types.length <= 1) back("/body/settings", "Keep at least one day type.");
  await db.batch([
    db.delete(schema.bodyDayTypes).where(and(eq(schema.bodyDayTypes.id, id), and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)))),
    db.delete(schema.bodyDays).where(and(eq(schema.bodyDays.dayTypeId, id), and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)))),
    db
      .update(schema.bodySettings)
      .set({ weekPattern: Object.fromEntries(Object.entries(settings.weekPattern).map(([d, t]) => [d, t === id ? null : t])), refeedDayTypeId: settings.refeedDayTypeId === id ? null : settings.refeedDayTypeId, updatedAt: nowIso() })
      .where(eq(schema.bodySettings.id, settings.id)),
  ]);
  refresh();
  await settle();
}

/** Set one date's day type by hand (a swapped lift day, an unplanned refeed), or clear it back to the pattern. */
export async function setBodyDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date)) return;
  const typeId = str(formData, "dayTypeId");
  const types = await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) });
  const existing = await db.query.bodyDays.findFirst({ where: and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), eq(schema.bodyDays.date, date)) });
  if (!typeId || !types.some((t) => t.id === typeId)) {
    // A day marked Off (B2) keeps its row: only the hand-set type goes.
    if (existing?.off) await db.update(schema.bodyDays).set({ dayTypeId: null }).where(eq(schema.bodyDays.id, existing.id));
    else if (existing) await db.delete(schema.bodyDays).where(eq(schema.bodyDays.id, existing.id));
  } else if (existing) await db.update(schema.bodyDays).set({ dayTypeId: typeId }).where(eq(schema.bodyDays.id, existing.id));
  else await db.insert(schema.bodyDays).values({ id: newId(), workspaceId, userId, date, dayTypeId: typeId });
  refresh();
  await settle();
}

/* ───────── Foods and meals ───────── */

export async function saveFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  // The unit comes from the dropdown (rev 229), or its "Other…" box for anything off the list.
  const choice = str(formData, "unitChoice");
  const unit = storedUnit(choice === "other" ? str(formData, "unitOther") : choice || str(formData, "unit")).slice(0, 30);
  if (!name || !unit) back("/body/foods", "A food needs a name and a unit (pick one, or type it under Other).");
  // Pantry (phase 5, rev 251): the nutrition's basis (cooked unless said raw), a par level, and an entered cooked yield in %.
  const yieldPct = await amount(formData, "yieldPct", null, "/body/foods");
  const par = await amount(formData, "par", unit, "/body/foods");
  const macro = async (k: string, to: string | null) => (await amount(formData, k, to, "/body/foods")) ?? 0;
  const food = { name, unit, cal: await macro("cal", null), p: await macro("p", "g"), f: await macro("f", "g"), c: await macro("c", "g"), sodium: await macro("sodium", null), capTag: opt(formData, "capTag")?.toLowerCase().slice(0, 30) ?? null, basis: str(formData, "basis") === "raw" ? ("raw" as const) : ("cooked" as const), section: (schema.FOOD_SECTIONS as readonly string[]).includes(str(formData, "section")) ? (str(formData, "section") as schema.FoodSection) : null, par: par != null && par > 0 ? par : null, cookedYield: yieldPct != null && yieldPct >= 10 && yieldPct <= 150 ? Math.round(yieldPct) / 100 : null };
  if ([food.cal, food.p, food.f, food.c, food.sodium].some((n) => n < 0)) back("/body/foods", `${name}: macros can't be negative.`);
  if (yieldPct != null && (yieldPct < 10 || yieldPct > 150)) back("/body/foods", `${name}: a cooked yield is between 10% and 150%.`);
  if (id) await db.update(schema.bodyFoods).set(food).where(and(eq(schema.bodyFoods.id, id), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))));
  else await db.insert(schema.bodyFoods).values({ id: newId(), workspaceId, userId, ...food });
  refresh();
  await settle();
}

/**
 * Save a found food (rev 237 phase 13): the result the member pressed Save on, carried through the form and read back whole,
 * written per their own food unit with the section and basis guessed. A food of the same name already there is updated, not
 * doubled. Back to the Find page with its name.
 */
export async function saveFoundFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const found = decodeFound(str(formData, "found"));
  if (!found) throw back("/body/foods/find", "That result couldn't be read. Search again.");
  const food = foodFromFound(found, settings.foodUnit);
  const have = await db.query.bodyFoods.findFirst({ where: and(and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)), eq(schema.bodyFoods.name, food.name)) });
  if (have) await db.update(schema.bodyFoods).set({ ...food, archivedAt: null }).where(eq(schema.bodyFoods.id, have.id));
  else await db.insert(schema.bodyFoods).values({ id: newId(), workspaceId, userId, ...food });
  const note = gapNote(found);
  redirect(`/body/foods/find?saved=${encodeURIComponent(food.name)}${note ? `&note=${encodeURIComponent(note)}` : ""}`);
}

/* ───────── Day flags and the week summary (rev 237 phase 15) ───────── */

/** Mark a day travelling or ill, or clear the mark; the row keeps its day type and Off. Patterns can leave such days out. */
export async function setBodyDayFlagAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date)) return;
  const raw = str(formData, "flag");
  const flag = isDayFlag(raw) ? raw : null;
  const existing = await db.query.bodyDays.findFirst({ where: and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), eq(schema.bodyDays.date, date)) });
  if (existing) await db.update(schema.bodyDays).set({ flag }).where(eq(schema.bodyDays.id, existing.id));
  else if (flag) await db.insert(schema.bodyDays).values({ id: newId(), workspaceId, userId, date, dayTypeId: null, off: false, flag });
  refresh();
  await settle();
}

export type SummaryState = { error?: string; text?: string; monday?: string } | undefined;

/**
 * "Summarise this week" (rev 196, B10's rule): the week's numbers, as weekNumbers phrases them (never a food, a note or a photo),
 * go to the member's own model with the task alone, only with their HumanOS AI switch on. Shown, not stored.
 */
export async function summariseWeekAction(_prev: SummaryState, f: FormData): Promise<SummaryState> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const monday = str(f, "monday");
  if (!DATE.test(monday)) return { error: "Pick a week first." };
  if (!settings.aiUse) return { error: "Turn on \"Let AI use my HumanOS data\" in HumanOS settings first; the summary runs on your own AI key.", monday };
  if (!(await allow(`body-summary:${userId}`, 10, 15 * 60000))) return { error: "That's a lot of summaries in a row. Wait 15 minutes and try again.", monday };
  const w = await bodyWeek(workspaceId, userId, startOfWeek(monday), v.today);
  if (!w) return { error: "Nothing to summarise yet.", monday };
  const numbers = weekNumbers({ label: `${w.monday} to ${w.sunday}`, nutrition: w.nutrition, prevNutrition: w.prevNutrition, training: w.training, prevTraining: w.prevTraining, weigh: { avg: w.weigh.avg, days: w.weigh.days }, prevWeigh: { avg: w.weigh.prevAvg, days: 0 }, weightUnit: w.settings.weightUnit, sleepAvg: w.sleep?.avg ?? null, burnAvg: w.burn?.avg ?? null, habits: w.habits ?? { due: 0, kept: 0 } });
  const text = await summariseWeek(numbers);
  if (!text) return { error: "AI didn't answer: it needs your own key on Settings, under today's cap, and a model that answers.", monday };
  return { text, monday };
}

/* ───────── A meal from a photo (rev 237 phase 14, B8) ───────── */

export type PhotoState = { error?: string; lines?: PhotoLine[]; note?: string | null } | undefined;

/**
 * Read the plate: the photo (downsized on the phone, base64) goes to the member's own model with the task and nothing else
 * (no Essence, feature meal_photo), and the lines come back for them to check. Nothing is logged here. The photo is never
 * stored or logged, and only with the member's HumanOS AI switch on, like every other AI use of their numbers.
 */
export async function mealPhotoAction(_prev: PhotoState, f: FormData): Promise<PhotoState> {
  const { v, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  if (!settings.aiUse) return { error: "Turn on \"Let AI use my HumanOS data\" in HumanOS settings first; the photo goes to your own AI key." };
  if (!(await allow(`body-photo:${userId}`, 20, 15 * 60000))) return { error: "That's a lot of photos in a row. Wait 15 minutes and try again." };
  const mediaType = str(f, "mediaType");
  const data = str(f, "image").replace(/^data:[^,]*,/, "");
  if (!isImageType(mediaType) || !data) return { error: "Pick a photo first (JPEG, PNG, WebP or GIF)." };
  if ((data.length * 3) / 4 > IMAGE_MAX_BYTES) return { error: "That photo is too large even after shrinking. Try a closer shot." };
  const read = await readPlate({ data, mediaType });
  if ("problem" in read) {
    if (read.problem === "model") return { error: "Your AI model can't read images. Pick one that can on Settings, or log the meal by hand." };
    if (read.problem === "no_answer") return { error: "AI didn't answer: it needs your own key on Settings, under today's cap, and a model that answers. Log the meal by hand for now." };
    return { error: "Nothing to log from that photo. Try a clearer shot, or log by hand." };
  }
  return { lines: read.lines, note: read.note };
}

/** Log the checked lines as one entry, "From a photo", with the member's quantities; nothing else is written. */
export async function logPhotoAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const { date, slot } = logTarget(formData, settings.mealSlots);
  const lines = readPhotoLines((k) => str(formData, k));
  if (!lines.length) back(`/body?date=${date}`, "Tick at least one line to log it.");
  const items = photoItems(lines);
  await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId, userId, date, slot, name: "From a photo", mealId: null, items, ...totalsOf(items) });
  refresh();
  await settle();
}

/** Archived foods leave the picker; meals and past days that use them keep working. */
export async function archiveFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  await db.update(schema.bodyFoods).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyFoods.id, str(formData, "id")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))));
  refresh();
  await settle();
}

/** A meal's items come as item_<n>_food / item_<n>_qty pairs; a blank food or a zero quantity drops the row. */
export async function saveMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  if (!name) back("/body/foods", "A meal needs a name.");
  const foods = await db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)) });
  const known = new Set(foods.map((f) => f.id));
  const items: schema.BodyMealItem[] = [];
  for (let i = 0; i < 20; i++) {
    const foodId = str(formData, `item_${i}_food`);
    const qty = (await amount(formData, `item_${i}_qty`, foods.find((f) => f.id === foodId)?.unit, "/body/foods")) ?? 0;
    if (known.has(foodId) && qty > 0) items.push({ foodId, qty });
  }
  if (!items.length) back("/body/foods", `${name}: add at least one food with a quantity.`);
  const slot = opt(formData, "slot");
  if (id) await db.update(schema.bodyMeals).set({ name, slot, items }).where(and(eq(schema.bodyMeals.id, id), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))));
  else await db.insert(schema.bodyMeals).values({ id: newId(), workspaceId, userId, name, slot, items });
  refresh();
  await settle();
}

export async function archiveMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  await db.update(schema.bodyMeals).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyMeals.id, str(formData, "id")), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))));
  refresh();
  await settle();
}

/* ───────── Logging ───────── */


function logTarget(formData: FormData, slots: string[]) {
  const date = str(formData, "date");
  const slot = str(formData, "slot");
  if (!DATE.test(date)) back("/body", "That date isn't valid.");
  return { date, slot: slots.includes(slot) ? slot : slot.slice(0, 30) || slots[0] || "Meal" };
}

/** One tap on a saved meal: its default quantities, or the adjusted ones (qty_<n>, per item in order) when opened. */
export async function logMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const { date, slot } = logTarget(formData, settings.mealSlots);
  const meal = await db.query.bodyMeals.findFirst({ where: and(eq(schema.bodyMeals.id, str(formData, "mealId")), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))) });
  if (!meal) return;
  const foods = await db.query.bodyFoods.findMany({ where: and(and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)), inArray(schema.bodyFoods.id, meal.items.map((i) => i.foodId))) });
  const byId = new Map(foods.map((f) => [f.id, f]));
  const typed: (number | null)[] = [];
  for (const [n, i] of meal.items.entries()) typed.push(await amount(formData, `qty_${n}`, byId.get(i.foodId)?.unit));
  const items = meal.items.flatMap((i, n) => {
    const food = byId.get(i.foodId);
    const adjusted = typed[n];
    const qty = adjusted !== null && adjusted >= 0 ? adjusted : i.qty;
    return food && qty > 0 ? [entryItem(food, qty)] : [];
  });
  if (!items.length) return;
  await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId, userId, date, slot, name: meal.name, mealId: meal.id, items, ...totalsOf(items) });
  await consumePantry(workspaceId, userId, items);
  refresh();
  await settle();
}

/** A food × a quantity. */
export async function logFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  const settings = await setUp(v);
  const { date, slot } = logTarget(formData, settings.mealSlots);
  const food = await db.query.bodyFoods.findFirst({ where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  if (!food) back(`/body?date=${date}`, "Pick a food.", "foodId");
  const typed = (await amount(formData, "qty", str(formData, "unit") || food!.unit, `/body?date=${date}`)) ?? 0;
  if (!(typed > 0)) back(`/body?date=${date}`, "Give a quantity above zero.", "qty");
  // Logged in another unit of the same group (g for a food per oz): converted into the food's own unit, so its macros apply.
  const as = str(formData, "unit") || food!.unit;
  const converted = convertQty(typed, as, food!.unit);
  if (converted === null) back(`/body?date=${date}`, `${food!.name} is per ${food!.unit}, which doesn't convert from ${as}.`);
  // Weighed raw or cooked (phase 5): across the food's basis it converts by the yield; with no yield it's kept and flagged.
  const said = str(formData, "weighed");
  const weighed = said === "raw" || said === "cooked" ? said : food!.basis;
  const factor = weighed === food!.basis ? null : yieldFor(food!, await db.query.bodyYields.findMany({ where: and(and(eq(schema.bodyYields.workspaceId, workspaceId), eq(schema.bodyYields.userId, userId)), eq(schema.bodyYields.foodId, food!.id)) })).factor;
  const asBasis = toBasis(Math.round(converted! * 100) / 100, weighed, food!.basis, factor);
  const items = [{ ...entryItem(food!, asBasis.qty), weighed, ...(asBasis.check ? { check: true } : {}) }];
  await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId, userId, date, slot, name: asBasis.check ? `${food!.name} (weighed raw, check the yield)` : food!.name, mealId: null, items, ...totalsOf(items) });
  await consumePantry(workspaceId, userId, items);
  refresh();
  await settle();
}

export async function deleteEntryAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "HumanOS is never open from a client's HelixOS." });
  await setUp(v);
  await db.delete(schema.bodyEntries).where(and(eq(schema.bodyEntries.id, str(formData, "id")), and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId))));
  refresh();
  await settle();
}

/* ───────── B2, workouts (rev 182) ───────── */

const TRAINING = "/body/training";
const R = "HumanOS is never open from a client's HelixOS.";
const trainingAt = (date: string) => `${TRAINING}?date=${date}`;

/** Add or rename an exercise. Weighted logs weight × reps; bodyweight logs reps, with any added weight. */
export async function saveExerciseAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  const kind = str(formData, "kind") === "bodyweight" ? "bodyweight" : "weight";
  if (!name) back(`${TRAINING}/routines`, "An exercise needs a name.", "name");
  // How far it steps up, in the member's unit (rev 486); blank lets it be learned again.
  const settings = await bodySettingsFor(workspaceId, userId);
  const stepTyped = await amount(formData, "step", settings?.weightUnit ?? "lb", `${TRAINING}/routines`);
  if (stepTyped != null && !(stepTyped > 0 && stepTyped <= 100)) back(`${TRAINING}/routines`, "A step is a weight above 0, up to 100.", "step");
  const step = stepTyped == null ? null : Math.round(stepTyped * 100) / 100;
  if (id) await db.update(schema.bodyExercises).set({ name, kind, step }).where(and(eq(schema.bodyExercises.id, id), and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId))));
  else await db.insert(schema.bodyExercises).values({ id: newId(), workspaceId, userId, name, kind, step });
  refresh();
  await settle();
}

/** Archived exercises leave the pickers; routines and past sessions that use them keep working. */
export async function archiveExerciseAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.update(schema.bodyExercises).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyExercises.id, str(formData, "id")), and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId))));
  refresh();
  await settle();
}

/** A routine's lines come as item_<n>_exercise / item_<n>_sets / item_<n>_reps; a blank exercise drops the row. */
export async function saveRoutineAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  if (!name) back(`${TRAINING}/routines`, "A routine needs a name.");
  const [exercises, types] = await Promise.all([
    db.query.bodyExercises.findMany({ where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)) }),
    db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) }),
  ]);
  const known = new Set(exercises.map((e) => e.id));
  const items: schema.BodyRoutineItem[] = [];
  for (let i = 0; i < 20; i++) {
    const exerciseId = str(formData, `item_${i}_exercise`);
    if (!known.has(exerciseId)) continue;
    items.push({ exerciseId, sets: Math.min(20, Math.max(1, Math.round((await amount(formData, `item_${i}_sets`, null, `${TRAINING}/routines`)) ?? 0) || 3)), reps: str(formData, `item_${i}_reps`).slice(0, 20) });
  }
  if (!items.length) back(`${TRAINING}/routines`, `${name}: add at least one exercise.`);
  const typeId = str(formData, "dayTypeId");
  const dayTypeId = types.some((t) => t.id === typeId) ? typeId : null;
  if (id) await db.update(schema.bodyRoutines).set({ name, dayTypeId, items }).where(and(eq(schema.bodyRoutines.id, id), and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId))));
  else await db.insert(schema.bodyRoutines).values({ id: newId(), workspaceId, userId, name, dayTypeId, items });
  refresh();
  await settle();
}

export async function archiveRoutineAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.update(schema.bodyRoutines).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyRoutines.id, str(formData, "id")), and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId))));
  refresh();
  await settle();
}

/** The day's session, made on first use: from a routine (its name copied) or empty. One per date; a second start is a no-op. */
async function sessionFor(workspaceId: string, userId: string, date: string, routine: schema.BodyRoutine | null) {
  await db
    .insert(schema.bodySessions)
    .values({ id: newId(), workspaceId, userId, date, routineId: routine?.id ?? null, routineName: routine?.name ?? null })
    .onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
  return (await db.query.bodySessions.findFirst({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), eq(schema.bodySessions.date, date)) }))!;
}

/** Start a day's workout, from a routine or without one. Starting takes the day off Off. */
export async function startSessionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date) || date > v.today) back(TRAINING, "That day isn't open for a workout.");
  const routineId = str(formData, "routineId");
  const routine = routineId ? ((await db.query.bodyRoutines.findFirst({ where: and(eq(schema.bodyRoutines.id, routineId), and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId))) })) ?? null) : null;
  const session = await sessionFor(workspaceId, userId, date, routine);
  // A session started empty takes the routine picked later; one already on a routine keeps it.
  if (routine && !session.routineId) await db.update(schema.bodySessions).set({ routineId: routine.id, routineName: routine.name }).where(and(eq(schema.bodySessions.id, session.id), and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId))));
  await db.update(schema.bodyDays).set({ off: false }).where(and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), eq(schema.bodyDays.date, date)));
  refresh();
  redirect(trainingAt(date));
}

/** One set, weight × reps, in the member's unit. Logging on a day with no session starts one without a routine. */
export async function logSetAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date) || date > v.today) back(TRAINING, "That day isn't open for a workout.");
  const exercise = await db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.id, str(formData, "exerciseId")), and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId))) });
  if (!exercise) back(trainingAt(date), "Pick an exercise.");
  const reps = Math.round((await amount(formData, "reps", null, trainingAt(date))) ?? 0);
  if (reps < 1 || reps > 1000) back(trainingAt(date), `${exercise!.name}: enter the reps.`, "reps");
  const raw = await amount(formData, "weight", settings.weightUnit, trainingAt(date));
  const weight = raw != null && raw > 0 && raw < 5000 ? raw : null;
  if (exercise!.kind === "weight" && weight == null) back(trainingAt(date), `${exercise!.name}: enter the weight.`, "weight");
  const session = await sessionFor(workspaceId, userId, date, null);
  await db.insert(schema.bodySets).values({ id: newId(), workspaceId, userId, sessionId: session.id, exerciseId: exercise!.id, date, weight, unit: settings.weightUnit, reps });
  // A set after "Finish workout" reopens the session (phase 3): finished means nothing more was logged.
  if (session.completedAt) await db.update(schema.bodySessions).set({ completedAt: null }).where(and(eq(schema.bodySessions.id, session.id), and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId))));
  refresh();
  await settle();
}

/** Merge one exercise into another (rev 507), after the preview: everything moves, and Undo is open for 7 days. */
export async function mergeExercisesAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const r = await mergeExercises(workspaceId, userId, str(formData, "merge"), str(formData, "into"));
  if ("error" in r) back(`${TRAINING}/routines`, r.error);
  refresh();
  redirect(`${TRAINING}/routines?said=${encodeURIComponent((r as { text: string }).text)}#exercises`);
}

export async function undoMergeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const r = await undoMerge(workspaceId, userId, str(formData, "id"));
  if ("error" in r) back(`${TRAINING}/routines`, r.error);
  refresh();
  redirect(`${TRAINING}/routines?said=${encodeURIComponent((r as { text: string }).text)}#exercises`);
}

/**
 * "Use next time" on a post-workout read (rev 471): the suggested weight becomes the routine's target for that exercise, shown
 * beside its sets and opening the next session's first set. One tap; the member can change it on Routines.
 */
export async function acceptTargetAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  const at = DATE.test(date) ? trainingAt(date) : TRAINING;
  // The weight the member will actually load (rev 486): the suggestion, or what they typed over it.
  const weight = await amount(formData, "weight", null, at);
  if (weight == null) back(at, "Give the weight for next time.", "weight");
  const saved = await saveNextWeight(workspaceId, userId, { routineId: str(formData, "routineId"), exerciseId: str(formData, "exerciseId"), weight: weight!, suggested: await amount(formData, "suggested", null, at), top: await amount(formData, "top", null, at) });
  if ("error" in saved) back(at, saved.error, "weight");
  refresh();
  await settle();
}

/** "Finish workout" (phase 3): the day's session is stamped done, with a note if one was typed. Logging another set reopens it. */
export async function finishSessionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date) || date > v.today) back(TRAINING, "That day isn't open for a workout.");
  const note = str(formData, "note").slice(0, 500) || null;
  const session = await sessionFor(workspaceId, userId, date, null);
  await db.update(schema.bodySessions).set({ completedAt: nowIso(), note }).where(and(eq(schema.bodySessions.id, session.id), and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId))));
  refresh();
  await settle();
}

/** Undo "Finish workout"; the note stays. */
export async function reopenSessionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date)) return;
  await db.update(schema.bodySessions).set({ completedAt: null }).where(and(eq(schema.bodySessions.date, date), and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId))));
  refresh();
  await settle();
}

export async function deleteSetAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.delete(schema.bodySets).where(and(eq(schema.bodySets.id, str(formData, "id")), and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId))));
  refresh();
  await settle();
}

/** Mark a day Off, or undo it. A day with sets logged can't be Off: delete them first. */
export async function setDayOffAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date) || date > v.today) return;
  const off = str(formData, "off") === "1";
  const where = and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), eq(schema.bodyDays.date, date));
  const existing = await db.query.bodyDays.findFirst({ where });
  if (off) {
    const anySet = await db.query.bodySets.findFirst({ columns: { id: true }, where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), eq(schema.bodySets.date, date)) });
    if (anySet) back(trainingAt(date), "This day has sets logged, so it isn't Off. Delete them first if it was a rest day.");
    if (existing) await db.update(schema.bodyDays).set({ off: true }).where(where);
    else await db.insert(schema.bodyDays).values({ id: newId(), workspaceId, userId, date, off: true });
    // An empty session started by mistake goes with it.
    await db.delete(schema.bodySessions).where(and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), eq(schema.bodySessions.date, date)));
  } else if (existing?.dayTypeId) await db.update(schema.bodyDays).set({ off: false }).where(where);
  else if (existing) await db.delete(schema.bodyDays).where(where);
  refresh();
  await settle();
}

/* ───────── Pantry (rev 237 phase 5) ───────── */

const PANTRY = "/body/pantry";
const stateOf = (s: string): "raw" | "cooked" => (s === "cooked" ? "cooked" : "raw");
const locationOf = (s: string): "fridge" | "freezer" | "pantry" => (s === "freezer" ? "freezer" : s === "pantry" ? "pantry" : "fridge");
const dateOrNull = (s: string): string | null => (DATE.test(s) ? s : null);

/** Something onto the shelf: a food, how much in what unit, raw or cooked, where, bought when, use by when. */
export async function savePantryItemAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const food = await db.query.bodyFoods.findFirst({ where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  if (!food) back(PANTRY, "Pick a food.", "foodId");
  const qty = (await amount(formData, "qty", str(formData, "unit") || food!.unit, PANTRY)) ?? 0;
  if (!(qty > 0)) back(PANTRY, "Give a quantity above zero.", "qty");
  const values = { foodId: food!.id, qty, unit: storedUnit(str(formData, "unit") || food!.unit).slice(0, 30), state: stateOf(str(formData, "state")), location: locationOf(str(formData, "location")), boughtOn: dateOrNull(str(formData, "boughtOn")), useBy: dateOrNull(str(formData, "useBy")) };
  const id = str(formData, "id");
  if (id) await db.update(schema.bodyPantry).set(values).where(and(eq(schema.bodyPantry.id, id), and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId))));
  else await db.insert(schema.bodyPantry).values({ id: newId(), workspaceId, userId, ...values });
  refresh();
  await settle();
}

export async function deletePantryItemAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.delete(schema.bodyPantry).where(and(eq(schema.bodyPantry.id, str(formData, "id")), and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId))));
  refresh();
  await settle();
}

/** Some of an item used or thrown out, outside a logged meal: the quantity comes down; at zero (or blank) the item goes. */
export async function usePantryAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const where = and(eq(schema.bodyPantry.id, str(formData, "id")), and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId)));
  const it = await db.query.bodyPantry.findFirst({ where });
  if (!it) return;
  const used = await amount(formData, "qty", it.unit, PANTRY);
  const left = used == null ? 0 : Math.round((it.qty - used) * 100) / 100;
  if (left <= 0) await db.delete(schema.bodyPantry).where(where);
  else await db.update(schema.bodyPantry).set({ qty: left }).where(where);
  refresh();
  await settle();
}

/** A food's par level, in its unit; blank clears it. */
export async function setFoodParAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const food = await db.query.bodyFoods.findFirst({ columns: { unit: true }, where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  const par = await amount(formData, "par", food?.unit, PANTRY);
  await db.update(schema.bodyFoods).set({ par: par != null && par > 0 ? par : null }).where(and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))));
  refresh();
  await settle();
}

/** One raw → cooked weighing of a food; the yield is the median of them (rev 251). */
export async function addYieldAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const food = await db.query.bodyFoods.findFirst({ where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  if (!food) back(PANTRY, "Pick a food.", "foodId");
  const weighedIn = str(formData, "unit") || "oz";
  const raw = (await amount(formData, "raw", weighedIn, PANTRY)) ?? 0;
  const cooked = (await amount(formData, "cooked", weighedIn, PANTRY)) ?? 0;
  if (!(raw > 0 && cooked > 0)) back(PANTRY, "Give both weights, raw and cooked.", raw > 0 ? "cooked" : "raw");
  if (cooked / raw < 0.1 || cooked / raw > 1.5) back(PANTRY, `${food!.name}: ${raw} raw → ${cooked} cooked isn't a yield (between 10% and 150%).`);
  await db.insert(schema.bodyYields).values({ id: newId(), workspaceId, userId, foodId: food!.id, raw, cooked, unit: storedUnit(str(formData, "unit") || "oz").slice(0, 30), date: v.today });
  refresh();
  await settle();
}

/* ───────── Body composition (rev 237 phase 2) ───────── */

const WEIGHT = "/body/weight";

/** A weigh-in typed in: the weight at least, in the member's unit, plus whatever else the scale showed. One reading, kept whole. */
export async function logWeighInAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const date = str(formData, "date") || v.today;
  if (!DATE.test(date) || date > v.today) back(WEIGHT, "Pick a day up to today.");
  const time = readTime(str(formData, "time"));
  const values: Partial<Record<MetricKey, number>> = {};
  for (const key of METRIC_KEYS) {
    // A mass typed in either unit ("70 kg" for a member in lb) is read in the member's unit first.
    const typed = await amount(formData, key, METRIC[key].unit === "mass" ? settings.weightUnit : null, WEIGHT);
    if (typed == null || typed <= 0) continue;
    const value = storedValue(key, typed, settings.weightUnit);
    if (!inRange(key, value)) back(WEIGHT, `${METRIC[key].label}: that number doesn't look right.`, key);
    values[key] = value;
  }
  if (values.weight == null) back(WEIGHT, "Enter your weight.", "weight");
  // The same step already in (imported from RENPHO, or told to Claude) takes what this adds, and stays one reading (rev 476).
  await saveReadings(workspaceId, userId, [{ date, time, values }], "manual");
  refresh();
  redirect(`${WEIGHT}?logged=1`);
}

/** One reading, all its numbers, gone. */
export async function deleteReadingAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.readingId, str(formData, "id")), and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId))));
  refresh();
  await settle();
}

/**
 * The RENPHO CSV, either format. The browser showed a preview from the same parser; the server parses the text again and trusts
 * only that. A reading already in (same date and time, or date and weight without a time) is skipped, so a re-export imports
 * only what's new. Nothing of the file is logged.
 */
export async function importScaleCsvAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const text = str(formData, "csv");
  if (!text) back(WEIGHT, "Choose a file first.");
  if (text.length > 4_000_000) back(WEIGHT, "That file is too big to import in one go.");
  const parsed = parseScaleCsv(text);
  if (!parsed.readings.length) back(WEIGHT, `Nothing to import: ${parsed.skipped[0]?.why ?? "no readings in the file"}.`);
  // Each reading against every reading already in on its day, whatever its source (rev 476): the same step typed or told to
  // Claude takes the numbers it lacks; a reading already in adds nothing.
  const saved = await saveReadings(workspaceId, userId, parsed.readings, "renpho");
  const fresh = saved.filter((x) => x.outcome === "new").length;
  const filled = saved.filter((x) => x.outcome === "filled").length;
  refresh();
  redirect(`${WEIGHT}?imported=${fresh}&already=${parsed.readings.length - fresh}&filled=${filled}&bad=${parsed.skipped.length}`);
}

/** A goal per metric, in the member's unit for masses; a blank target clears it. */
export async function setBodyGoalAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const key = str(formData, "key");
  if (!(key in METRIC) || !METRIC[key as MetricKey].primary) return;
  const typed = await amount(formData, "target", METRIC[key as MetricKey].unit === "mass" ? settings.weightUnit : null, WEIGHT);
  const by = str(formData, "by");
  const m = { workspaceId, userId };
  if (typed == null || typed <= 0) {
    // Blank clears it: archived, so Goals keeps it under Archived (rev 508 §5).
    const existing = await db.query.bodyGoals.findFirst({ where: and(and(eq(schema.bodyGoals.workspaceId, workspaceId), eq(schema.bodyGoals.userId, userId)), eq(schema.bodyGoals.key, key)) });
    if (existing && !existing.archivedAt) await archiveGoal(m, existing.id);
  } else {
    const target = storedValue(key as MetricKey, typed, settings.weightUnit);
    if (!inRange(key as MetricKey, target)) back(WEIGHT, `${METRIC[key as MetricKey].label} goal: that number doesn't look right.`, "target");
    if (DATE.test(by) && by <= v.today) back(WEIGHT, "Pick a date after today, or leave it blank.", "by");
    await setGoal(m, { kind: "scale", metric: key, target, by: DATE.test(by) ? by : null }, v.today);
  }
  refresh();
  await settle();
}

/* ───────── Goals (rev 508 §5) ───────── */

const GOALS = "/body/goals";

/**
 * A goal from the Goals page: a scale number, the waist, a lift (a weight for reps), a habit or workouts (a count a week), or
 * average sleep. Targets typed in the member's units; an optional start (else the 7-day average today) and date.
 */
export async function saveGoalAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const unit = settings.weightUnit;
  const kind = schema.BODY_GOAL_KINDS.find((k) => k === str(formData, "kind"));
  if (!kind) back(GOALS, "Pick what the goal is of.", "kind");
  const metric = kind === "scale" ? str(formData, "metric") : null;
  if (kind === "scale" && (!metric || !(metric in METRIC) || !METRIC[metric as MetricKey].primary)) back(GOALS, "Pick the number on the scale.", "metric");
  const refId = kind === "lift" || kind === "habit" ? str(formData, "refId") : null;
  if (kind === "lift" && !(await db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId), eq(schema.bodyExercises.id, refId ?? "")) }))) back(GOALS, "Pick the lift.", "refId");
  if (kind === "habit" && !(await db.query.bodyHabits.findFirst({ where: and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId), eq(schema.bodyHabits.id, refId ?? "")) }))) back(GOALS, "Pick the habit.", "refId");
  const massLike = (kind === "scale" && METRIC[metric as MetricKey]?.unit === "mass") || kind === "lift";
  const typed = await amount(formData, "target", massLike ? unit : null, GOALS);
  if (typed == null || typed <= 0) back(GOALS, "Give the goal a target.", "target");
  const g = { kind: kind!, key: goalKey(kind!, metric, refId) };
  const target = storedTarget(g, typed!, unit);
  if (kind === "scale" && !inRange(metric as MetricKey, target)) back(GOALS, `${METRIC[metric as MetricKey].label}: that target doesn't look right.`, "target");
  if ((kind === "habit" || kind === "training") && (target > 7 || !Number.isInteger(target))) back(GOALS, "A week has seven days: a whole number from 1 to 7.", "target");
  if (kind === "sleep" && target > 12) back(GOALS, "Sleep: a target in hours, up to 12.", "target");
  if (kind === "waist" && (target < 15 || target > 80)) back(GOALS, "Waist: that number doesn't look right.", "target");
  const reps = kind === "lift" ? Math.round(Number(str(formData, "reps")) || 1) : null;
  if (reps != null && (reps < 1 || reps > 50)) back(GOALS, "Reps: from 1 to 50.", "reps");
  const by = str(formData, "by");
  if (by && (!DATE.test(by) || by <= v.today)) back(GOALS, "Pick a date after today, or leave it blank.", "by");
  const startTyped = str(formData, "start") ? await amount(formData, "start", massLike ? unit : null, GOALS) : null;
  await setGoal({ workspaceId, userId }, { kind: kind!, metric, refId, reps, target, by: by || null, startValue: startTyped != null ? storedTarget(g, startTyped, unit) : null }, v.today);
  refresh();
  redirect(`${GOALS}?saved=1`);
}

export async function archiveGoalAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await archiveGoal({ workspaceId, userId }, str(formData, "id"), str(formData, "back") === "1");
  refresh();
  redirect(GOALS);
}

/** A waist measurement in the member's length (inches, or cm in metric), for the waist goal. */
export async function logWaistAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const date = str(formData, "date") || v.today;
  if (!DATE.test(date) || date > v.today) back(GOALS, "Pick a day up to today.", "date");
  const typed = await amount(formData, "waist", null, GOALS);
  if (typed == null || typed <= 0) back(GOALS, "Enter the measurement.", "waist");
  const inches = storedTarget({ kind: "waist", key: "waist" }, typed!, settings.weightUnit);
  if (inches < 15 || inches > 80) back(GOALS, "Waist: that number doesn't look right.", "waist");
  await logWaist({ workspaceId, userId }, date, inches);
  refresh();
  redirect(`${GOALS}?waist=1`);
}

/* ───────── The coach, when shared ───────── */

/** A coach's comment on one of the client's days: only while the client shares, and only on a day, never on their data. */
export async function addBodyCommentAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const membershipId = str(formData, "membershipId");
  const date = str(formData, "date");
  const text = str(formData, "text").slice(0, 1000);
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || (await bodyAccess(v, m.userId)) !== "coach") redirect("/coach");
  if (!DATE.test(date) || !text) return;
  await db.insert(schema.bodyComments).values({ id: newId(), workspaceId: v.workspace.id, userId: m!.userId, date, authorUserId: v.user.id, text });
  refresh();
  await settle();
}

/* ───────── Delete all ───────── */

/**
 * Every Body row of the member's, gone, after typing DELETE. The rest of their HelixOS is untouched. Not behind the Body flag on
 * purpose: deleting your own data is always allowed, even if Body is later switched off for you.
 */
export async function eraseBodyAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Deleting {first}'s data is theirs to ask for." });
  if (str(formData, "confirm").toUpperCase() !== "DELETE") back("/body/settings", "Nothing was deleted: type DELETE to confirm.");
  await db.batch([
    db.delete(schema.bodyMedLogs).where(and(eq(schema.bodyMedLogs.workspaceId, workspaceId), eq(schema.bodyMedLogs.userId, userId))),
    db.delete(schema.bodyMeds).where(and(eq(schema.bodyMeds.workspaceId, workspaceId), eq(schema.bodyMeds.userId, userId))),
    db.delete(schema.bodyTemplateSends).where(and(eq(schema.bodyTemplateSends.workspaceId, workspaceId), eq(schema.bodyTemplateSends.userId, userId))),
    db.delete(schema.bodyCheckins).where(and(eq(schema.bodyCheckins.workspaceId, workspaceId), eq(schema.bodyCheckins.userId, userId))),
    db.delete(schema.bodyActivities).where(and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId))),
    db.delete(schema.bodyDevices).where(and(eq(schema.bodyDevices.workspaceId, workspaceId), eq(schema.bodyDevices.userId, userId))),
    db.delete(schema.bodyOrders).where(and(eq(schema.bodyOrders.workspaceId, workspaceId), eq(schema.bodyOrders.userId, userId))),
    db.delete(schema.bodyPlan).where(and(eq(schema.bodyPlan.workspaceId, workspaceId), eq(schema.bodyPlan.userId, userId))),
    db.delete(schema.bodyHealth).where(and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId))),
    db.delete(schema.bodyHabitLogs).where(and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId))),
    db.delete(schema.bodyHabits).where(and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId))),
    db.delete(schema.bodyPantry).where(and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId))),
    db.delete(schema.bodyYields).where(and(eq(schema.bodyYields.workspaceId, workspaceId), eq(schema.bodyYields.userId, userId))),
    db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId))),
    db.delete(schema.bodyGoals).where(and(eq(schema.bodyGoals.workspaceId, workspaceId), eq(schema.bodyGoals.userId, userId))),
    db.delete(schema.bodyIngestTokens).where(and(eq(schema.bodyIngestTokens.workspaceId, workspaceId), eq(schema.bodyIngestTokens.userId, userId))),
    db.delete(schema.bodySets).where(and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId))),
    db.delete(schema.bodySessions).where(and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId))),
    db.delete(schema.bodyRoutines).where(and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId))),
    db.delete(schema.bodyExercises).where(and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId))),
    db.delete(schema.bodyEntries).where(and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId))),
    db.delete(schema.bodyDays).where(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId))),
    db.delete(schema.bodyComments).where(and(eq(schema.bodyComments.workspaceId, workspaceId), eq(schema.bodyComments.userId, userId))),
    db.delete(schema.bodyMeals).where(and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))),
    db.delete(schema.bodyFoods).where(and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))),
    db.delete(schema.bodyDayTypes).where(and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId))),
    db.delete(schema.bodyShareEvents).where(and(eq(schema.bodyShareEvents.workspaceId, workspaceId), eq(schema.bodyShareEvents.userId, userId))),
    db.delete(schema.bodySettings).where(and(eq(schema.bodySettings.workspaceId, workspaceId), eq(schema.bodySettings.userId, userId))),
  ]);
  refresh();
  redirect("/body?erased=1");
}

/* ── The Airtable history (B5, rev 237 phase 7): dry run, then Approve; the token lives in the form for that run only. ── */

const IMPORT = "/body/import";
/** What the page shows after a dry run. No token is ever in here. */
export type HistoryPreview = { key: string; summary: HistorySummary; plan: HistoryPlan };
export type HistoryState = { error?: string; changed?: boolean; preview?: HistoryPreview } | undefined;

async function prepareHistory(v: Viewer, workspaceId: string, userId: string, f: FormData): Promise<{ error: string } | { plan: HistoryPlan; existing: Existing; preview: HistoryPreview }> {
  if (!(await allow(`body-import:${userId}`, 30, 15 * 60000))) return { error: "That's a lot of runs in a row. Wait 15 minutes and try again." };
  const from = str(f, "from");
  if (from && !DATE.test(from)) return { error: "The start date is a date, like 2026-01-01, or empty." };
  let read: Awaited<ReturnType<typeof readHumanos>>;
  try {
    read = await readHumanos({ baseId: str(f, "base"), token: str(f, "token") });
  } catch (e) {
    if (e instanceof AirtableError) return { error: airtableProblem(e).replace(/^Source base: /, "") };
    return { error: "Couldn't read the base. Nothing was imported; try again in a minute." };
  }
  if (read.missing.includes("journal")) return { error: "This base has no Journal table. Check the base id." };
  const existing = await existingHistory(workspaceId, userId);
  const plan = buildHistoryPlan(read.source, existing, { notes: str(f, "notes") === "1", from: from || null, dayTypesOnly: str(f, "dayTypesOnly") === "1" });
  plan.missing = read.missing;
  const key = createHash("sha256").update(JSON.stringify([userId, plan])).digest("hex").slice(0, 32);
  return { plan, existing, preview: { key, summary: historySummary(plan), plan } };
}

/**
 * The member's own HumanOS history from Airtable: the dry run reads and maps, Approve reads again and writes only if the plan is
 * the one they saw. The token is used inside this call and kept nowhere.
 */
export async function importHistoryAction(_prev: HistoryState, f: FormData): Promise<HistoryState> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const r = await prepareHistory(v, workspaceId, userId, f);
  if ("error" in r) return { error: r.error };
  if (str(f, "intent") !== "approve") return { preview: r.preview };
  if (r.preview.key !== str(f, "key")) return { changed: true, preview: r.preview };
  const { written } = await applyHistory(r.plan, r.existing, workspaceId, userId);
  refresh();
  redirect(`${IMPORT}?done=${written}&at=${Date.now()}`);
}

/* ── Habits, sleep and the health log (rev 237 phase 8, B7). ── */

const PRACTICES = "/body/practices";
const SLEEP = "/body/sleep";
const HEALTH = "/body/training/health";
/** Where a one-tap chip goes back to: a local path on this site, else Practices. */
const backTo = (f: FormData, fallback: string) => {
  const b = str(f, "back");
  return /^\/[a-z0-9/_#?=&.-]*$/i.test(b) ? b : fallback;
};

/** Add or edit a habit: from the starter list (name, kind, unit, target posted by the chip) or the member's own words. */
export async function saveHabitAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 60);
  if (!name) back(PRACTICES, "A habit needs a name.");
  const kindRaw = str(formData, "kind");
  const kind = (schema.HABIT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as schema.HabitKind) : "done";
  const unit = kind === "amount" ? str(formData, "unit").slice(0, 12) || null : kind === "count" ? str(formData, "unit").slice(0, 12) || null : null;
  const t = await amount(formData, "target", kind === "amount" ? unit : null, PRACTICES);
  const target = kind === "done" || t == null || t <= 0 ? null : t;
  const days = daysFrom([0, 1, 2, 3, 4, 5, 6].filter((d) => formData.get(`d${d}`) === "1" || formData.get(`d${d}`) === "on"));
  const diff = str(formData, "difficulty");
  const difficulty = diff === "easy" || diff === "medium" || diff === "hard" ? diff : null;
  const own = and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId));
  if (id) await db.update(schema.bodyHabits).set({ name, kind, unit, target, days, difficulty }).where(and(eq(schema.bodyHabits.id, id), own));
  else {
    const have = await db.query.bodyHabits.findMany({ columns: { id: true, name: true, archivedAt: true }, where: own });
    const same = have.find((h) => h.name.toLowerCase() === name.toLowerCase());
    // Adding a name already there brings it back rather than doubling it.
    if (same) await db.update(schema.bodyHabits).set({ archivedAt: null, kind, unit, target, days, difficulty }).where(and(eq(schema.bodyHabits.id, same.id), own));
    else await db.insert(schema.bodyHabits).values({ id: newId(), workspaceId, userId, name, kind, unit, target, days, difficulty, order: have.length });
  }
  refresh();
  redirect(PRACTICES);
}

/** An archived habit leaves the page; its logs stay for the record and the export. */
export async function archiveHabitAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.update(schema.bodyHabits).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyHabits.id, str(formData, "id")), and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId))));
  refresh();
  redirect(PRACTICES);
}

/* ───────── Supplements, vitamins and prescriptions (rev 424; Joy and Tom, rev 431) ───────── */

const MEDS = "/body/practices/meds";
const ownMed = (workspaceId: string, userId: string, id: string) => and(eq(schema.bodyMeds.id, id), and(eq(schema.bodyMeds.workspaceId, workspaceId), eq(schema.bodyMeds.userId, userId)));
const optInt = async (f: FormData, k: string, lo: number, hi: number): Promise<number | null> => {
  const n = await amount(f, k, null, MEDS);
  return n == null ? null : Math.min(hi, Math.max(lo, Math.round(n)));
};
const optDate = (f: FormData, k: string): string | null => (DATE.test(str(f, k)) ? str(f, k) : null);

/** Add or change one item: what it is, when it's taken, the supply, and for a script its dates, repeats and refill rule. */
export async function saveMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  if (!name) back(MEDS, "Give it a name.");
  const type = (MED_TYPES as readonly string[]).includes(str(formData, "type")) ? (str(formData, "type") as MedType) : "supplement";
  const withFood = (WITH_FOOD as readonly string[]).includes(str(formData, "withFood")) ? (str(formData, "withFood") as WithFood) : null;
  const issuedOn = optDate(formData, "issuedOn");
  const months = await optInt(formData, "expiryMonths", 1, 24);
  // An expiry typed wins; else 6 or 12 months from the issue date when picked (Joy).
  const expiresOn = optDate(formData, "expiresOn") ?? (issuedOn && months ? expiryFrom(issuedOn, months) : null);
  const scriptKind: "paper" | "electronic" | null = str(formData, "scriptKind") === "paper" ? "paper" : str(formData, "scriptKind") === "electronic" ? "electronic" : null;
  const values = {
    name,
    type,
    dose: opt(formData, "dose")?.slice(0, 60) ?? null,
    howTaken: opt(formData, "howTaken")?.slice(0, 80) ?? null,
    timesPerDay: await optInt(formData, "timesPerDay", 0, 12) ?? 1,
    days: daysFrom([0, 1, 2, 3, 4, 5, 6].filter((d) => formData.get(`d${d}`) === "1" || formData.get(`d${d}`) === "on")),
    withFood,
    note: opt(formData, "note")?.slice(0, 200) ?? null,
    perDose: Math.max(0.25, Math.min(100, await amount(formData, "perDose", null, MEDS) ?? 1)),
    unitWord: opt(formData, "unitWord")?.slice(0, 20) ?? null,
    onHand: await (async () => {
      const n = await amount(formData, "onHand", null, MEDS);
      return n == null ? null : Math.max(0, Math.min(100000, n));
    })(),
    supplyDays: await optInt(formData, "supplyDays", 1, 400),
    repeatsLeft: type === "prescription" ? await optInt(formData, "repeatsLeft", 0, 99) : null,
    lastFilledOn: optDate(formData, "lastFilledOn"),
    issuedOn: type === "prescription" ? issuedOn : null,
    expiresOn: type === "prescription" ? expiresOn : null,
    scriptKind: type === "prescription" ? scriptKind : null,
    refillRule: str(formData, "refillRule") === "share_used" ? ("share_used" as const) : ("before_runout" as const),
    refillDays: await optInt(formData, "refillDays", 0, 60) ?? 12,
    refillShare: await optInt(formData, "refillShare", 1, 100) ?? 75,
    remindDays: await optInt(formData, "remindDays", 0, 60) ?? 5,
    remindOn: str(formData, "remindOn") === "refill_open" ? ("refill_open" as const) : ("runout" as const),
    pharmacy: type === "prescription" ? opt(formData, "pharmacy")?.slice(0, 80) ?? null : null,
    prescriber: type === "prescription" ? opt(formData, "prescriber")?.slice(0, 80) ?? null : null,
  };
  if (id) await db.update(schema.bodyMeds).set(values).where(ownMed(workspaceId, userId, id));
  else {
    const have = await db.query.bodyMeds.findMany({ columns: { name: true, archivedAt: true }, where: and(eq(schema.bodyMeds.workspaceId, workspaceId), eq(schema.bodyMeds.userId, userId)) });
    if (have.some((m) => !m.archivedAt && m.name.toLowerCase() === name.toLowerCase())) back(MEDS, `${name} is already on your list.`);
    await db.insert(schema.bodyMeds).values({ id: newId(), workspaceId, userId, ...values });
  }
  refresh();
  redirect(MEDS);
}

/** Archive: off the list and Today; the record and its taken days stay for the export. */
export async function archiveMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.update(schema.bodyMeds).set({ archivedAt: nowIso() }).where(ownMed(workspaceId, userId, str(formData, "id")));
  refresh();
  redirect(MEDS);
}

/** Take (or un-take) one dose of the day; a dose from the bottle comes off the count, one from a filled box already did. */
export async function takeMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const to = backTo(formData, MEDS);
  const date = str(formData, "date") || v.today;
  if (!DATE.test(date) || date > v.today) back(to, "That day isn't open yet.");
  const med = await db.query.bodyMeds.findFirst({ where: ownMed(workspaceId, userId, str(formData, "medId")) });
  if (!med) throw back(to, "Pick one from your list.");
  const slot = Math.max(1, Math.min(12, Math.round((await amount(formData, "slot", null, MEDS)) ?? 0) || 1));
  const have = await db.query.bodyMedLogs.findFirst({ where: and(eq(schema.bodyMedLogs.medId, med.id), eq(schema.bodyMedLogs.date, date), eq(schema.bodyMedLogs.slot, slot)) });
  const fromBottle = takesFromBottle(med, date) && med.onHand != null;
  if (have) {
    await db.delete(schema.bodyMedLogs).where(eq(schema.bodyMedLogs.id, have.id));
    if (fromBottle) await db.update(schema.bodyMeds).set({ onHand: Math.round((med.onHand! + med.perDose) * 100) / 100 }).where(eq(schema.bodyMeds.id, med.id));
  } else {
    await db.insert(schema.bodyMedLogs).values({ id: newId(), workspaceId, userId, medId: med.id, date, slot });
    if (fromBottle) await db.update(schema.bodyMeds).set({ onHand: Math.max(0, Math.round((med.onHand! - med.perDose) * 100) / 100) }).where(eq(schema.bodyMeds.id, med.id));
  }
  refresh();
  redirect(to);
}

/** Refilled: a fill's supply (or the number typed) goes on the count, a repeat comes off; an expired script or none left refuses. */
export async function refillMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const med = await db.query.bodyMeds.findFirst({ where: ownMed(workspaceId, userId, str(formData, "id")) });
  if (!med) throw back(MEDS, "Pick one from your list.");
  const r = refill(med, v.today, await amount(formData, "added", null, MEDS));
  if (!r.ok) throw back(MEDS, r.why);
  await db.update(schema.bodyMeds).set({ onHand: r.onHand, repeatsLeft: r.repeatsLeft, lastFilledOn: r.lastFilledOn }).where(eq(schema.bodyMeds.id, med.id));
  refresh();
  redirect(`${MEDS}?said=${encodeURIComponent(`${med.name}: +${r.added} on hand, now ${r.onHand}${r.repeatsLeft != null ? `; ${r.repeatsLeft} repeat${r.repeatsLeft === 1 ? "" : "s"} left` : ""}.`)}`);
}

/** Filled pill boxes (Tom): that many days of doses move from the bottle to the boxes. */
export async function fillBoxesMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const med = await db.query.bodyMeds.findFirst({ where: ownMed(workspaceId, userId, str(formData, "id")) });
  if (!med) throw back(MEDS, "Pick one from your list.");
  const r = fillBoxes(med, (await amount(formData, "days", null, MEDS)) || 14, v.today, { addDays, daysBetween, weekday });
  if (!r.ok) throw back(MEDS, r.why);
  await db.update(schema.bodyMeds).set({ onHand: r.onHand, boxedUntil: r.boxedUntil }).where(eq(schema.bodyMeds.id, med.id));
  refresh();
  redirect(`${MEDS}?said=${encodeURIComponent(`${med.name}: bottle ${med.onHand ?? 0} → ${r.onHand}; boxes cover to ${r.boxedUntil}.`)}`);
}

/** Count what's left: the bottle set to the number typed. */
export async function countMedAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const med = await db.query.bodyMeds.findFirst({ where: ownMed(workspaceId, userId, str(formData, "id")) });
  if (!med) throw back(MEDS, "Pick one from your list.");
  const n = await amount(formData, "onHand", null, MEDS);
  if (n == null || n < 0) throw back(MEDS, "Type how many are left.");
  await db.update(schema.bodyMeds).set({ onHand: Math.min(100000, n) }).where(eq(schema.bodyMeds.id, med.id));
  refresh();
  redirect(`${MEDS}?said=${encodeURIComponent(`${med.name}: bottle ${med.onHand ?? "—"} → ${n}.`)}`);
}

/** The area's own two switches: the coach sees it only with medsShare (and the day shared); an AI reads it only with medsAi. */
export async function setMedsSwitchAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: R });
  const settings = await setUp(v);
  const which = str(formData, "which");
  const on = str(formData, "on") === "1";
  if (which === "share") await db.update(schema.bodySettings).set({ medsShare: on }).where(eq(schema.bodySettings.id, settings.id));
  else if (which === "ai") await db.update(schema.bodySettings).set({ medsAi: on }).where(eq(schema.bodySettings.id, settings.id));
  refresh();
  redirect(MEDS);
}

/** Restore (rev 386): an archived habit comes back where it was, its logs and streak history untouched. */
export async function restoreHabitAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.update(schema.bodyHabits).set({ archivedAt: null }).where(and(eq(schema.bodyHabits.id, str(formData, "id")), and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId))));
  refresh();
  redirect(PRACTICES);
}

/** Delete (rev 386): only an archived habit, from the archived fold, after the confirm that counts its logged days; the habit and every log go for good. */
export async function deleteHabitAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const h = await db.query.bodyHabits.findFirst({ where: and(eq(schema.bodyHabits.id, str(formData, "id")), and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId))) });
  if (!h || !h.archivedAt) back(PRACTICES, "Archive a habit before deleting it; nothing active is one tap from gone.");
  await db.delete(schema.bodyHabitLogs).where(and(eq(schema.bodyHabitLogs.habitId, h!.id), and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId))));
  await db.delete(schema.bodyHabits).where(eq(schema.bodyHabits.id, h!.id));
  refresh();
  redirect(PRACTICES);
}

/**
 * One tap: a done habit toggles (value 1, or the row removed); a measured one takes the number typed. Today or a past day, never
 * the future. Goes back where the chip was (Today or Practices).
 */
export async function logHabitAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const to = backTo(formData, PRACTICES);
  const date = str(formData, "date") || v.today;
  if (!DATE.test(date) || date > v.today) back(to, "That day isn't open yet.");
  const habit = await db.query.bodyHabits.findFirst({ where: and(eq(schema.bodyHabits.id, str(formData, "habitId")), and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId))) });
  if (!habit) throw back(to, "Pick a habit.");
  const existing = await db.query.bodyHabitLogs.findFirst({ where: and(eq(schema.bodyHabitLogs.habitId, habit.id), eq(schema.bodyHabitLogs.date, date)) });
  let value: number | null;
  if (habit.kind === "done") value = str(formData, "value") === "0" || (str(formData, "value") === "" && existing) ? null : 1;
  else {
    // Typed in the member's system (rev 424), stored in the habit's own unit, so a switch never rewrites a day. "500 ml" in a
    // habit shown in fl oz is read in fl oz first (rev 444).
    const settings = await bodySettingsFor(workspaceId, userId);
    const shown = habitShown(habit.unit, habit.target, isMeasures(settings?.measures) ? settings!.measures : "us");
    const n = await amount(formData, "value", habit.kind === "amount" ? (shown.unit ?? habit.unit) : null, to);
    if (n == null) throw back(to, `How much ${habit.name.toLowerCase()}? Give a number.`, "value");
    const typed = storedFromShown(n, shown);
    value = typed > 0 && typed < 1_000_000 ? typed : null;
  }
  if (existing) await db.delete(schema.bodyHabitLogs).where(and(eq(schema.bodyHabitLogs.id, existing.id), and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId))));
  if (value != null) await db.insert(schema.bodyHabitLogs).values({ id: newId(), workspaceId, userId, habitId: habit.id, date, value, source: "manual" });
  refresh();
  redirect(to);
}

/** A night's sleep: hours (7:30 or 7.5) and an optional score, on the morning it ended; logging a night again replaces it. */
export async function logSleepAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date") || v.today;
  if (!DATE.test(date) || date > v.today) back(SLEEP, "That night hasn't happened yet.");
  const hours = parseHours(str(formData, "hours"));
  if (hours == null || !recoveryInRange("sleep_h", hours)) throw back(SLEEP, "Hours slept: give a time like 7:30 or 7.5.");
  const score = await amount(formData, "score", null, "/body/sleep");
  if (score != null && !recoveryInRange("sleep_score", score)) back(SLEEP, "A sleep score is 0 to 100.");
  const readingId = sleepReadingId(date);
  const own = and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId));
  await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.readingId, readingId), own));
  const rows = [{ id: newId(), workspaceId, userId, date, key: "sleep_h", value: Math.round(hours * 100) / 100, source: "manual" as const, readingId, time: null }];
  if (score != null) rows.push({ id: newId(), workspaceId, userId, date, key: "sleep_score", value: Math.round(score), source: "manual", readingId, time: null });
  await db.insert(schema.bodyDaily).values(rows);
  refresh();
  redirect(SLEEP);
}

export async function deleteSleepAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date)) return;
  await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.readingId, sleepReadingId(date)), and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId))));
  refresh();
  await settle();
}

/** The health log (revs 231, 251): an injury with its start, side, the movements it affects and the exercises to leave out. Member-only. */
export async function saveHealthAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const id = str(formData, "id");
  const title = str(formData, "title").slice(0, 80);
  if (!title) back(HEALTH, "Say what it is, in a few words.");
  const startedOn = str(formData, "startedOn") || v.today;
  if (!DATE.test(startedOn) || startedOn > v.today) back(HEALTH, "The start is a date, today or before.");
  const resolvedRaw = str(formData, "resolvedOn");
  const resolvedOn = resolvedRaw && DATE.test(resolvedRaw) && resolvedRaw >= startedOn ? resolvedRaw : null;
  const sideRaw = str(formData, "side");
  const side = (schema.HEALTH_SIDES as readonly string[]).includes(sideRaw) ? (sideRaw as (typeof schema.HEALTH_SIDES)[number]) : null;
  const movements = str(formData, "movements").slice(0, 200) || null;
  const mine = await db.query.bodyExercises.findMany({ columns: { id: true }, where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)) });
  const ok = new Set(mine.map((e) => e.id));
  const restricted = formData.getAll("restricted").map(String).filter((x) => ok.has(x));
  const own = and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId));
  if (id) await db.update(schema.bodyHealth).set({ title, side, startedOn, resolvedOn, movements, restricted }).where(and(eq(schema.bodyHealth.id, id), own));
  else await db.insert(schema.bodyHealth).values({ id: newId(), workspaceId, userId, title, side, startedOn, resolvedOn, movements, restricted });
  refresh();
  redirect(HEALTH);
}

/** Resolved on a date (today unless given): its restrictions lift; the entry stays in the log. */
export async function resolveHealthAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const on = str(formData, "resolvedOn") || v.today;
  if (!DATE.test(on)) back(HEALTH, "The resolved day is a date.");
  const reopen = str(formData, "reopen") === "1";
  await db.update(schema.bodyHealth).set({ resolvedOn: reopen ? null : on }).where(and(eq(schema.bodyHealth.id, str(formData, "id")), and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId))));
  refresh();
  redirect(HEALTH);
}

export async function deleteHealthAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await db.delete(schema.bodyHealth).where(and(eq(schema.bodyHealth.id, str(formData, "id")), and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId))));
  refresh();
  redirect(HEALTH);
}

/* ── Shopping and Instacart (rev 237 phase 10). ── */

const SHOPPING = "/body/shopping";

/** This week's plan: a saved meal so many times; 0 takes it off. */
export async function setPlanAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const mealId = str(formData, "mealId");
  const meal = await db.query.bodyMeals.findFirst({ where: and(eq(schema.bodyMeals.id, mealId), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))) });
  if (!meal) back(SHOPPING, "Pick one of your saved meals.");
  const times = Math.max(0, Math.min(21, Math.round((await amount(formData, "times", null, SHOPPING)) ?? 1)));
  const monday = startOfWeek(v.today);
  const own = and(and(eq(schema.bodyPlan.workspaceId, workspaceId), eq(schema.bodyPlan.userId, userId)), and(eq(schema.bodyPlan.monday, monday), eq(schema.bodyPlan.mealId, mealId)));
  await db.delete(schema.bodyPlan).where(own);
  if (times > 0) await db.insert(schema.bodyPlan).values({ id: newId(), workspaceId, userId, monday, mealId, times });
  refresh();
  redirect(SHOPPING);
}

/** Bought: the line goes on the shelf as the food's basis, in the fridge, bought today. */
export async function boughtAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const food = await db.query.bodyFoods.findFirst({ where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  if (!food) throw back(SHOPPING, "Pick a food.");
  const qty = await amount(formData, "qty", food.unit, SHOPPING);
  if (qty == null || qty <= 0) throw back(SHOPPING, `How much ${food.name.toLowerCase()}?`, "qty");
  await db.insert(schema.bodyPantry).values({ id: newId(), workspaceId, userId, foodId: food.id, qty, unit: food.unit, state: food.basis, location: "fridge", boughtOn: v.today, useBy: null });
  refresh();
  redirect(SHOPPING);
}

/**
 * Push to Instacart: the list as shown (less any lines dropped on the page) becomes a shopping-list page, and its link is logged
 * as an order with status "link". The member opens it, picks the store, reviews and pays in Instacart. HelixOS places nothing.
 */
export async function pushInstacartAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  if (!INSTACART_OPEN) throw back(SHOPPING, INSTACART_SOON_LINE);
  const skip = new Set(str(formData, "skip").split(",").filter(Boolean));
  const view = await shoppingView(workspaceId, userId, v.today, skip);
  if (!view || !view.list.lines.length) throw back(SHOPPING, "Nothing on the list to send.");
  const lines = instacartLines(view.list.lines);
  const logged = lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit }));
  try {
    const link = await createShoppingListLink("HelixOS shopping list", lines, null);
    const id = newId();
    await db.insert(schema.bodyOrders).values({ id, workspaceId, userId, lines: logged, link, status: "link", note: null });
    refresh();
    redirect(`${SHOPPING}?pushed=${id}`);
  } catch (e) {
    if (e instanceof InstacartError) {
      await db.insert(schema.bodyOrders).values({ id: newId(), workspaceId, userId, lines: logged, link: null, status: "failed", note: e.problem });
      throw back(SHOPPING, instacartProblem(e));
    }
    throw e;
  }
}

/* ── WHOOP (B6, rev 237 phase 11). Connect is a GET to /api/body/whoop/start; these are the rest. ── */

const DEVICES = "/body/settings#devices";

/** Disconnect deletes the row, tokens and all. What was pulled stays. */
export async function disconnectWhoopAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await disconnectWhoop(workspaceId, userId);
  refresh();
  redirect(DEVICES);
}

/**
 * Apple Health (rev 508 §4): a new key for the Shortcut, returned to the page that asked and shown there once. Never in a URL,
 * a log or the database (only its hash). Making one revokes the one before.
 */
export async function makeHealthKeyAction(): Promise<{ key: string } | { error: string }> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  const key = await makeHealthKey({ workspaceId, userId });
  refresh();
  return { key };
}

export async function revokeHealthKeyAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  await revokeHealthKey({ workspaceId, userId });
  refresh();
  redirect(DEVICES);
}

/** Sync now: the last 30 days pulled again. */
export async function syncWhoopAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: R });
  await setUp(v);
  // From two days before the last finished sync (rev 473), and it says what it did, or why not, beside the button.
  let said: string;
  try {
    said = syncWords(await syncWhoop(workspaceId, userId, v.tz));
  } catch (e) {
    redirect(`/body/settings?whoopError=${encodeURIComponent(e instanceof WhoopError ? whoopProblem(e) : "WHOOP couldn't answer just now. Try again in a minute.")}#devices`);
  }
  refresh();
  redirect(`${DEVICES.replace("#devices", "")}?whoop=synced&said=${encodeURIComponent(said)}#devices`);
}
