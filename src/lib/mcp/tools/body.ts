/**
 * Body's MCP tools (rev 237 phase 4, rev 247 B6): the member's own token, the `body` scope, and Body's AI switch, which the
 * server's gate checks before every call and `ready` checks again here, so a handler reached any other way refuses the same
 * way. Reads answer from the queries the pages use; the draft-writes (a meal, a food, a set, a weigh-in) follow the forms'
 * rules. Nothing here returns photos, injuries or what a coach wrote (revs 219 and 251), and nothing of a call is logged.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { newId } from "@/lib/ids";
import { MACROS, MACRO_LABEL, MARK_ICON, dayTypeIdFor, entryItem, fmtBand, fmtMacro, slotNow, totalsOf, type Macro, type Macros } from "@/lib/engine/body";
import { convertQty, loggableUnits, storedUnit } from "@/lib/engine/body-units";
import { fmtSet } from "@/lib/engine/body-training";
import { METRIC, fmtMetric, inRange, readTime, storedValue, type MetricKey } from "@/lib/engine/body-scale";
import { PANTRY_LOCATIONS, toBasis, yieldFor } from "@/lib/engine/body-pantry";
import { consumePantry } from "@/lib/body-pantry";
import { fmtPer100, perUnit, readBarcode } from "@/lib/engine/body-find";
import { FoodSearchError, foodSearchProblem, lookupBarcode, searchFoods } from "@/lib/food-search";
import { activitiesOn, bodyDay, bodyLibrary, bodyRange, bodySettingsFor, bodyWeek, canAiUseBody, correlate, habitsRange, sleepRange, trainingRange, dayComposition, exerciseHistory, habitsDay, habitsFor, insightMetrics, latestComposition, pantryView, shoppingView, sleepView, trainingDay, trainingLibrary, trainingWeeks, weighIns, dayTypesFor } from "@/lib/queries/body";
import { fmtDistance, zonesText } from "@/lib/engine/body-whoop";
import { PRESETS } from "@/lib/engine/body-correlate";
import { isRangeKey, rangeBounds, rateText } from "@/lib/engine/body-range";
import { addDays } from "@/lib/dates";
import { instacartLines, listSummary } from "@/lib/engine/body-shopping";
import { InstacartError, createShoppingListLink, instacartProblem } from "@/lib/instacart";
import { KIND_LABEL, STARTER_HABITS, daysFrom, fmtDays, fmtHabitValue, fmtTarget, kept } from "@/lib/engine/body-habits";
import { fmtBedtime, fmtHours, fmtWake, parseHours, recoveryInRange, sleepReadingId } from "@/lib/engine/body-recovery";
import { startOfWeek } from "@/lib/dates";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Body's own switch, again, then the member's settings: no settings means Body isn't set up, and every tool says so. */
async function ready(v: Viewer): Promise<schema.BodySettings> {
  if (!(await canAiUseBody(v, v.user.id))) throw new Error("HumanOS's AI switch is off for this member, so HumanOS tools do nothing. They can turn it on in HumanOS settings.");
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) throw new Error("HumanOS isn't set up for this member yet: they start it from the Log page.");
  return settings;
}

/** A day argument: today by default, never the future. */
function dayOf(v: Viewer, date: unknown): string {
  const d = typeof date === "string" && DATE.test(date) ? date : v.today;
  if (d > v.today) throw new Error(`${d} is in the future; today is ${v.today}.`);
  return d;
}

/** A thing by name: an exact match (case aside) first, else the one whose name contains the words, else the names to pick from. */
function byName<T extends { name: string }>(what: string, list: T[], name: string): T {
  const n = String(name ?? "").trim().toLowerCase();
  const exact = list.find((x) => x.name.toLowerCase() === n);
  if (exact) return exact;
  const partial = n ? list.filter((x) => x.name.toLowerCase().includes(n)) : [];
  if (partial.length === 1) return partial[0];
  const names = (partial.length ? partial : list).map((x) => x.name);
  throw new Error(`No ${what} called "${name}"${partial.length ? ` exactly; ${partial.length} match it` : ""}. Pick from: ${names.slice(0, 25).join(", ")}${names.length > 25 ? "…" : ""}.`);
}

const macroLine = (t: Macros) => MACROS.map((m) => `${fmtMacro(m, t[m])} ${MACRO_LABEL[m]}`).join(", ");

/** "62 g P to go, 14 g F left, 40 cal over": what's left of each band. */
function leftText(left: Partial<Record<Macro, { min: number; max: number }>>): string {
  return MACROS.flatMap((m) => {
    const b = left[m];
    if (!b) return [];
    if (b.max < 0) return [`${fmtMacro(m, -b.max)} ${MACRO_LABEL[m]} over`];
    if (b.min > 0) return [`${fmtMacro(m, b.min)} ${MACRO_LABEL[m]} to go`];
    return [`up to ${fmtMacro(m, b.max)} ${MACRO_LABEL[m]} left`];
  }).join(", ");
}

/** The day after a write: the new totals and what's left, so Claude can answer in one go. */
async function dayAfter(v: Viewer, date: string): Promise<string> {
  const d = await bodyDay(v.workspace.id, v.user.id, date, v.today);
  if (!d) return "";
  return `${date === v.today ? "Today" : date} so far: ${macroLine(d.totals)}${d.left ? `. Left: ${leftText(d.left)}` : ""}.`;
}

/* ───────── Reads ───────── */

export const bodyToday = defineTool({
  name: "body_today",
  scope: "body",
  kind: "read",
  description: "The member's HumanOS day: the day type and its targets, what they've eaten with the totals and marks, what's left, which saved meals fit, caps and sodium, the latest weigh-in, and the day's workout. Today unless a date (YYYY-MM-DD) is given.",
  input: { date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const [d, t, figure] = await Promise.all([bodyDay(v.workspace.id, v.user.id, date, v.today), trainingDay(v.workspace.id, v.user.id, date), dayComposition(v.workspace.id, v.user.id, date)]);
    if (!d) throw new Error("HumanOS isn't set up for this member yet.");
    const lines = [`${date === v.today ? "Today" : date}${d.dayType ? `, a ${d.dayType.name}` : ""}${d.dayType?.reminder ? ` (reminder: ${d.dayType.reminder})` : ""}.`];
    lines.push(d.bands ? `Targets: ${MACROS.filter((m) => d.bands![m]).map((m) => `${fmtBand(m, d.bands![m]!)} ${MACRO_LABEL[m]}`).join(", ")}.` : "No targets set for this day type yet.");
    lines.push(d.entries.length ? `Eaten: ${d.entries.map((e) => `${e.slot}: ${e.name} (${macroLine({ cal: e.cal, p: e.p, f: e.f, c: e.c })})`).join("; ")}.` : "Nothing logged yet.");
    if (d.entries.length) lines.push(`Total: ${macroLine(d.totals)}${d.marks ? ` (${MACROS.filter((m) => d.marks![m]).map((m) => `${MACRO_LABEL[m]} ${MARK_ICON[d.marks![m]!]}`).join(", ")})` : ""}.`);
    if (d.left && !d.final) lines.push(`Left: ${leftText(d.left)}.`);
    if (d.fits.length) lines.push(`Saved meals that fit what's left: ${d.fits.map((f) => f.name).join(", ")}.`);
    if (d.caps.length) lines.push(`Caps: ${d.caps.map((c) => `${c.label} ${c.used} of ${c.soft}${c.hard > c.soft ? ` (hard ${c.hard})` : ""} ${c.unit}`).join("; ")}.`);
    if (d.sodium) lines.push(`Sodium: ${Math.round(d.sodium).toLocaleString("en-US")} mg.`);
    if (d.dueSoon.length) lines.push(`Use soon from the pantry: ${d.dueSoon.map((u) => `${u.name} (${u.days < 0 ? "past its date" : u.days === 0 ? "today" : u.days === 1 ? "tomorrow" : `${u.days} days`})`).join(", ")}.`);
    const latest = figure ?? (await latestComposition(v.workspace.id, v.user.id));
    if (latest?.values.weight != null) lines.push(`${latest.date === date ? "Weigh-in" : `Latest weigh-in (${latest.date})`}: ${fmtMetric("weight", latest.values.weight, settings.weightUnit)}${latest.values.bf != null ? `, ${fmtMetric("bf", latest.values.bf, settings.weightUnit)} body fat` : ""}.`);
    if (t?.off) lines.push("Training: marked Off.");
    else if (t?.session) lines.push(`Training: ${t.routineName ?? "a workout"}${t.plan.plannedSets ? `, ${t.plan.doneSets} of ${t.plan.plannedSets} planned sets` : `, ${t.plan.doneSets} sets`}${t.completedAt ? ", finished" : ""}: ${t.exercises.filter((x) => x.today.length).map((x) => `${x.exercise.name} ${x.today.map((s) => fmtSet(s, t.unit, x.exercise.kind)).join(", ")}`).join("; ") || "no sets yet"}.`);
    else if (t?.suggested) lines.push(`Training: ${t.suggested.name} is on the plan for this day type, not started.`);
    const hd = await habitsDay(v.workspace.id, v.user.id, date, v.today);
    const due = hd.habits.filter((h) => h.due);
    if (due.length) lines.push(`Habits: ${due.filter((h) => h.kept).length} of ${due.length} kept (${due.map((h) => `${h.name} ${h.kept ? "✓" : h.value != null ? `${h.valueText} so far` : "not yet"}`).join(", ")}).`);
    return {
      text: lines.join("\n"),
      data: { date, dayType: d.dayType?.name ?? null, bands: d.bands, totals: d.totals, marks: d.marks, left: d.left, entries: d.entries.map((e) => ({ slot: e.slot, name: e.name, cal: e.cal, p: e.p, f: e.f, c: e.c })), fits: d.fits.map((f) => f.name), sodium: d.sodium, weighIn: latest ? { date: latest.date, values: latest.values } : null, training: t ? { off: t.off, routine: t.routineName, finished: !!t.completedAt, plan: t.plan } : null },
    };
  },
});

export const bodyFoods = defineTool({
  name: "body_foods",
  scope: "body",
  kind: "read",
  description: "The member's food library: each food with its unit and macros per unit, and their saved meals with the lines and totals. Use the names here when logging.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    await ready(v);
    const lib = await bodyLibrary(v.workspace.id, v.user.id);
    const foods = lib.foods.map((f) => `${f.name} (per ${f.unit}): ${macroLine(f)}${f.sodium ? `, ${f.sodium} mg sodium` : ""}${f.capTag ? `, tag ${f.capTag}` : ""}`);
    const meals = lib.meals.map((m) => `${m.name}${m.slot ? ` (${m.slot})` : ""} = ${macroLine(m.totals)}: ${m.lines.map((l) => `${l.qty} ${l.food.unit} ${l.food.name}`).join(", ")}`);
    return {
      text: `${lib.foods.length} foods:\n${foods.join("\n") || "none yet"}\n\n${lib.meals.length} saved meals:\n${meals.join("\n") || "none yet"}`,
      data: { foods: lib.foods.map((f) => ({ name: f.name, unit: f.unit, cal: f.cal, p: f.p, f: f.f, c: f.c, sodium: f.sodium, capTag: f.capTag })), meals: lib.meals.map((m) => ({ name: m.name, slot: m.slot, totals: m.totals, lines: m.lines.map((l) => ({ food: l.food.name, qty: l.qty, unit: l.food.unit })) })) },
    };
  },
});

export const bodyWeighIns = defineTool({
  name: "body_weigh_ins",
  scope: "body",
  kind: "read",
  description: "Weigh-ins: the latest figure, the 7-day average and its change against last week, the goal, and the recent readings. The day's figure is its lowest reading, kept whole.",
  input: { days: z.number().int().min(7).max(365).optional().describe("How many days back for the trend; 30 when left out"), range: z.enum(["week", "month", "90d", "year"]).optional().describe("Instead of days: a week (7), a month (30), 90 days or a year") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const byRange = { week: 7, month: 30, "90d": 90, year: 365 } as Record<string, number>;
    const days = typeof input.days === "number" ? Math.min(365, Math.max(7, Math.round(input.days))) : isRangeKey(input.range) ? byRange[input.range] : 30;
    const w = await weighIns(v.workspace.id, v.user.id, v.today, days);
    if (!w) throw new Error("HumanOS isn't set up for this member yet.");
    if (!w.latest) return { text: "No weigh-ins logged yet.", data: { readings: [] } };
    const unit = w.unit;
    const cards = w.cards.filter((c) => c.stats.latest).map((c) => `${c.metric.label}: ${fmtMetric(c.metric.key, c.stats.latest!.value, unit)} (${c.stats.latest!.date})${c.stats.avg7 != null ? `, 7-day average ${fmtMetric(c.metric.key, c.stats.avg7, unit)}` : ""}${c.stats.change7 != null ? `, ${c.stats.change7 > 0 ? "+" : ""}${fmtMetric(c.metric.key, c.stats.change7, unit)} vs last week` : ""}${c.goal ? `, goal ${fmtMetric(c.metric.key, c.goal.target, unit)}${c.goal.by ? ` by ${c.goal.by}` : ""}` : ""}`);
    const recent = w.readings.slice(0, 10).map((r) => `${r.date}${r.time ? ` ${r.time}` : ""}: ${r.values.weight != null ? fmtMetric("weight", r.values.weight, unit) : "—"}${r.values.bf != null ? `, ${fmtMetric("bf", r.values.bf, unit)}` : ""} (${r.source})`);
    return {
      text: `Last ${days} days.\n${cards.join("\n")}\n\nRecent readings:\n${recent.join("\n")}`,
      data: { unit, cards: w.cards.filter((c) => c.stats.latest).map((c) => ({ key: c.metric.key, latest: c.stats.latest, avg7: c.stats.avg7, change7: c.stats.change7, goal: c.goal ? { target: c.goal.target, by: c.goal.by } : null })), readings: w.readings.slice(0, 10).map((r) => ({ date: r.date, time: r.time, source: r.source, values: r.values })) },
    };
  },
});

export const bodyTraining = defineTool({
  name: "body_training",
  scope: "body",
  kind: "read",
  description: "Training: the day's workout against its plan with last time and the PR beside each exercise, and this week's tally; or, with an exercise name, that exercise's history and PR.",
  input: { exercise: z.string().optional().describe("An exercise name for its history; leave out for the day"), date: z.string().optional().describe("YYYY-MM-DD; today when left out"), range: z.enum(["week", "month", "90d", "year"]).optional().describe("With no exercise: training over that span instead of a day (sessions, sets, PRs, routines, per week)"), from: z.string().optional() },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    if (!input.exercise && isRangeKey(input.range)) {
      const b = rangeBounds(input.range, typeof input.from === "string" ? input.from : null, v.today, { addDays, startOfWeek });
      const r = await trainingRange(v.workspace.id, v.user.id, b, v.today);
      if (!r) throw new Error("HumanOS isn't set up for this member yet.");
      return { text: `${b.label}: ${r.sessions} sessions, ${r.sets} sets, ${r.prs} PR${r.prs === 1 ? "" : "s"}${r.routines.length ? `; ${r.routines.map((x) => `${x.name} × ${x.times}`).join(", ")}` : ""}. Sessions by week: ${r.perWeekSessions.map((w) => `${w.monday} ${w.value ?? 0}`).join(", ")}.`, data: { range: b, sessions: r.sessions, sets: r.sets, prs: r.prs, routines: r.routines, perWeek: r.perWeekSessions.map((w) => ({ monday: w.monday, sessions: w.value ?? 0, sets: r.perWeekSets.find((x) => x.monday === w.monday)?.value ?? 0 })) } };
    }
    await ready(v);
    if (typeof input.exercise === "string" && input.exercise.trim()) {
      const lib = await trainingLibrary(v.workspace.id, v.user.id);
      const ex = byName("exercise", lib.exercises, input.exercise);
      const h = await exerciseHistory(v.workspace.id, v.user.id, ex.id);
      if (!h) throw new Error("HumanOS isn't set up for this member yet.");
      const sessions = h.sessions.slice(0, 12).map((s) => `${s.date}: ${s.sets.map((x) => `${x.text}${x.pr ? " (PR)" : ""}`).join(", ")}`);
      return { text: `${ex.name}${h.pr ? `, PR ${h.pr.text} on ${h.pr.date}` : ", no sets yet"}.\n${sessions.join("\n")}`, data: { exercise: ex.name, kind: ex.kind, unit: h.unit, pr: h.pr, points: h.points, sessions: h.sessions.slice(0, 12) } };
    }
    const date = dayOf(v, input.date);
    const [t, weeks, activities] = await Promise.all([trainingDay(v.workspace.id, v.user.id, date), trainingWeeks(v.workspace.id, v.user.id, v.today), activitiesOn(v.workspace.id, v.user.id, date)]);
    if (!t) throw new Error("HumanOS isn't set up for this member yet.");
    const lines: string[] = [];
    if (t.off) lines.push(`${date === v.today ? "Today" : date} is marked Off.`);
    else if (t.session) lines.push(`${date === v.today ? "Today" : date}: ${t.routineName ?? "a workout"}${t.plan.plannedSets ? `, ${t.plan.doneSets} of ${t.plan.plannedSets} planned sets` : `, ${t.plan.doneSets} sets`}${t.completedAt ? `, finished${t.note ? ` ("${t.note}")` : ""}` : ""}.`);
    else lines.push(`${date === v.today ? "Today" : date}: no workout started${t.suggested ? `; ${t.suggested.name} is on the plan for this day type` : ""}.`);
    for (const x of t.exercises) lines.push(`${x.exercise.name}${x.target ? ` (plan ${x.target.sets} × ${x.target.reps || "?"})` : ""}: ${x.today.length ? x.today.map((s) => `${fmtSet(s, t.unit, x.exercise.kind)}${s.pr ? " (PR)" : ""}`).join(", ") : "no sets yet"}${x.last.length ? `; last time ${x.lastDate}: ${x.last.join(", ")}` : ""}${x.pr ? `; PR ${x.pr.text}` : ""}.`);
    if (weeks) lines.push(`This week: ${weeks.tally.done}${weeks.tally.planned != null ? ` of ${weeks.tally.planned}` : ""} session${weeks.tally.done === 1 && weeks.tally.planned == null ? "" : "s"}.`);
    // Phase 16b: the device's workouts that day, under the session.
    if (activities.length) lines.push(`Recorded by the device: ${activities.map((a) => `${a.sport} ${Math.round(a.minutes)} min${a.strain != null ? `, strain ${a.strain}` : ""}${a.avgHr != null ? `, ${a.avgHr} bpm` : ""}${fmtDistance(a.distanceM) ? `, ${fmtDistance(a.distanceM)}` : ""}${zonesText(a.zones) ? `, zones ${zonesText(a.zones)}` : ""}`).join("; ")}.`);
    return { text: lines.join("\n"), data: { date, off: t.off, routine: t.routineName, finished: !!t.completedAt, plan: t.plan, exercises: t.exercises.map((x) => ({ name: x.exercise.name, kind: x.exercise.kind, target: x.target, today: x.today.map((s) => ({ weight: s.weight, unit: s.unit, reps: s.reps, pr: s.pr })), last: x.last, pr: x.pr })), week: weeks?.tally ?? null, activities: activities.map((a) => ({ sport: a.sport, minutes: a.minutes, strain: a.strain, avgHr: a.avgHr, maxHr: a.maxHr, distanceM: a.distanceM, zones: a.zones, underSession: !!a.sessionId })) } };
  },
});

/* ───────── Draft-writes: the same rules as the forms ───────── */

export const bodyLogMeal = defineTool({
  name: "body_log_meal",
  scope: "body",
  kind: "write",
  description: "Log one of the member's saved meals by name, with its default quantities, into a slot (their own slot names; the likely one for the hour when left out). Today unless a date is given. Answers with the day's totals and what's left.",
  input: { meal: z.string().describe("The saved meal's name"), slot: z.string().optional().describe("Breakfast, Lunch, Dinner, Snack, or the member's own slot names"), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const lib = await bodyLibrary(v.workspace.id, v.user.id);
    const meal = byName("saved meal", lib.meals, String(input.meal ?? ""));
    const items = meal.lines.filter((l) => l.qty > 0).map((l) => entryItem(l.food, l.qty));
    if (!items.length) throw new Error(`${meal.name} has no foods left in it.`);
    const slot = slotFor(settings.mealSlots, input.slot, v.hour, meal.slot);
    await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, slot, name: meal.name, mealId: meal.id, items, ...totalsOf(items) });
    await consumePantry(v.workspace.id, v.user.id, items);
    return { text: `Logged ${meal.name} to ${slot}${date === v.today ? "" : ` on ${date}`}: ${macroLine(totalsOf(items))}.\n${await dayAfter(v, date)}`, data: { logged: { name: meal.name, slot, date, totals: totalsOf(items) } } };
  },
});

export const bodyLogFood = defineTool({
  name: "body_log_food",
  scope: "body",
  kind: "write",
  description: "Log one of the member's foods by name × a quantity, in the food's own unit or another of the same kind (oz, g, lb, kg; cup, tbsp, tsp, fl oz, ml), into a slot. Today unless a date is given. Answers with the day's totals and what's left.",
  input: { food: z.string().describe("The food's name"), qty: z.number().positive().describe("How much"), unit: z.string().optional().describe("The unit typed, when not the food's own"), weighed: z.enum(["raw", "cooked"]).optional().describe("Whether the quantity was weighed raw or cooked, for a food counted the other way; converts by the food's yield"), slot: z.string().optional(), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const lib = await bodyLibrary(v.workspace.id, v.user.id);
    const food = byName("food", lib.foods, String(input.food ?? ""));
    const typed = Number(input.qty);
    if (!Number.isFinite(typed) || typed <= 0) throw new Error("Give a quantity above zero.");
    const unit = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim() : food.unit;
    const allowed = loggableUnits(food.unit);
    const qty = unit === food.unit ? typed : convertQty(typed, unit, food.unit);
    if (qty == null) throw new Error(`${food.name} is counted per ${food.unit}; log it in ${allowed.join(", ")}.`);
    // Weighed raw or cooked (phase 5): across the food's basis it converts by the yield; with no yield it's kept and flagged.
    const weighed = input.weighed === "raw" || input.weighed === "cooked" ? input.weighed : food.basis;
    const factor = weighed === food.basis ? null : yieldFor(food, await db.query.bodyYields.findMany({ where: and(and(eq(schema.bodyYields.workspaceId, v.workspace.id), eq(schema.bodyYields.userId, v.user.id)), eq(schema.bodyYields.foodId, food.id)) })).factor;
    const asBasis = toBasis(Math.round(qty * 100) / 100, weighed, food.basis, factor);
    const items = [{ ...entryItem(food, asBasis.qty), weighed, ...(asBasis.check ? { check: true } : {}) }];
    const slot = slotFor(settings.mealSlots, input.slot, v.hour, null);
    await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, slot, name: asBasis.check ? `${food.name} (weighed raw, check the yield)` : food.name, mealId: null, items, ...totalsOf(items) });
    await consumePantry(v.workspace.id, v.user.id, items);
    const asText = `${typed} ${unit}${unit !== food.unit ? ` (${qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${food.unit})` : ""}${asBasis.converted ? `, ${asBasis.qty} ${food.unit} ${food.basis} at a ${Math.round(factor! * 100)}% yield` : asBasis.check ? `, weighed ${weighed} with no yield known for a food counted ${food.basis}: logged as is, marked to check` : ""}`;
    return { text: `Logged ${asText} ${food.name} to ${slot}${date === v.today ? "" : ` on ${date}`}: ${macroLine(totalsOf(items))}.\n${await dayAfter(v, date)}`, data: { logged: { name: food.name, qty: asBasis.qty, unit: food.unit, basis: food.basis, weighed, check: asBasis.check, slot, date, totals: totalsOf(items) } } };
  },
});

/** The slot to log into: the member's own if named (their names, case aside), else the meal's usual one, else the hour's. */
function slotFor(slots: string[], asked: unknown, hour: number, usual: string | null): string {
  if (typeof asked === "string" && asked.trim()) {
    const a = asked.trim().toLowerCase();
    const own = slots.find((s) => s.toLowerCase() === a);
    if (own) return own;
    if (asked.trim().length <= 30) return asked.trim();
  }
  if (usual && slots.includes(usual)) return usual;
  return slotNow(slots, hour);
}

export const bodyLogSet = defineTool({
  name: "body_log_set",
  scope: "body",
  kind: "write",
  description: "Log one set for an exercise by name: weight (in the member's unit) × reps, or reps alone for a bodyweight exercise (plus any weight added). Starts the day's session if none. Today unless a date is given. Answers with the set's place in the day and the PR.",
  input: { exercise: z.string().describe("The exercise's name"), reps: z.number().int().min(1).max(1000), weight: z.number().positive().optional().describe("In the member's weight unit; left out for a bodyweight exercise with nothing added"), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const lib = await trainingLibrary(v.workspace.id, v.user.id);
    const exercise = byName("exercise", lib.exercises, String(input.exercise ?? ""));
    const reps = Math.round(Number(input.reps));
    if (!Number.isFinite(reps) || reps < 1 || reps > 1000) throw new Error("Give the reps, 1 to 1000.");
    const raw = input.weight == null ? null : Number(input.weight);
    const weight = raw != null && Number.isFinite(raw) && raw > 0 && raw < 5000 ? raw : null;
    if (exercise.kind === "weight" && weight == null) throw new Error(`${exercise.name} is logged as weight × reps: give the weight in ${settings.weightUnit}.`);
    await db.insert(schema.bodySessions).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, routineId: null, routineName: null }).onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
    const session = (await db.query.bodySessions.findFirst({ where: and(eq(schema.bodySessions.workspaceId, v.workspace.id), eq(schema.bodySessions.userId, v.user.id), eq(schema.bodySessions.date, date)) }))!;
    await db.insert(schema.bodySets).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, sessionId: session.id, exerciseId: exercise.id, date, weight, unit: settings.weightUnit, reps });
    if (session.completedAt) await db.update(schema.bodySessions).set({ completedAt: null }).where(and(eq(schema.bodySessions.id, session.id), and(eq(schema.bodySessions.workspaceId, v.workspace.id), eq(schema.bodySessions.userId, v.user.id))));
    const t = await trainingDay(v.workspace.id, v.user.id, date);
    const x = t?.exercises.find((e) => e.exercise.id === exercise.id);
    const set = x?.today[x.today.length - 1];
    return { text: `Logged ${exercise.name} ${fmtSet({ weight, unit: settings.weightUnit, reps }, settings.weightUnit, exercise.kind)}${x ? ` (set ${x.today.length}${x.target ? ` of ${x.target.sets} planned` : ""} ${date === v.today ? "today" : `on ${date}`})` : ""}${set?.pr ? ". A new PR!" : x?.pr ? (x.pr.date === date ? `. Today's PR stands at ${x.pr.text}.` : `. PR stays ${x.pr.text}.`) : "."}${session.completedAt ? " The session was finished; it's open again." : ""}`, data: { exercise: exercise.name, date, weight, unit: settings.weightUnit, reps, pr: !!set?.pr, setsToday: x?.today.length ?? 1 } };
  },
});

export const bodyLogWeighIn = defineTool({
  name: "body_log_weigh_in",
  scope: "body",
  kind: "write",
  description: "Log a weigh-in: weight in the member's unit, body fat % if known, and any other scale numbers (skeletal muscle %, water %, visceral fat, BMR, metabolic age). Today unless a date is given; a time (HH:MM) if known. The day's figure is its lowest reading.",
  input: {
    weight: z.number().positive().describe("In the member's weight unit"),
    bodyFat: z.number().positive().optional().describe("Body fat %"),
    skeletalMuscle: z.number().positive().optional().describe("Skeletal muscle %"),
    water: z.number().positive().optional().describe("Body water %"),
    visceral: z.number().positive().optional(),
    bmr: z.number().positive().optional().describe("kcal"),
    metabolicAge: z.number().positive().optional(),
    date: z.string().optional().describe("YYYY-MM-DD; today when left out"),
    time: z.string().optional().describe("HH:MM"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const time = typeof input.time === "string" ? readTime(input.time) : null;
    const typed: [MetricKey, unknown][] = [["weight", input.weight], ["bf", input.bodyFat], ["smm_pct", input.skeletalMuscle], ["water", input.water], ["visceral", input.visceral], ["bmr", input.bmr], ["met_age", input.metabolicAge]];
    const readingId = newId();
    const rows = typed.flatMap(([key, raw]) => {
      if (raw == null) return [];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return [];
      const value = storedValue(key, n, settings.weightUnit);
      if (!inRange(key, value)) throw new Error(`${METRIC[key].label}: ${n} doesn't look right.`);
      return [{ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, key, value, source: "manual" as const, readingId, time }];
    });
    if (!rows.some((r) => r.key === "weight")) throw new Error("Give the weight.");
    await db.insert(schema.bodyDaily).values(rows);
    const figure = await dayComposition(v.workspace.id, v.user.id, date);
    const w = rows.find((r) => r.key === "weight")!.value;
    const bf = rows.find((r) => r.key === "bf")?.value;
    return { text: `Logged ${fmtMetric("weight", w, settings.weightUnit)}${bf != null ? `, ${fmtMetric("bf", bf, settings.weightUnit)} body fat` : ""}${date === v.today ? "" : ` for ${date}`}${time ? ` at ${time}` : ""}.${figure?.values.weight != null && figure.values.weight !== w ? ` The day's figure stays its lowest reading, ${fmtMetric("weight", figure.values.weight, settings.weightUnit)}.` : ""}`, data: { date, time, values: Object.fromEntries(rows.map((r) => [r.key, r.value])), dayFigure: figure?.values ?? null } };
  },
});

/* ───────── Pantry (rev 237 phase 5) ───────── */

export const bodyPantry = defineTool({
  name: "body_pantry",
  scope: "body",
  kind: "read",
  description: "The member's pantry: what's on the shelf (how much, raw or cooked, where, use by), what to use within two days, what's below its par level and how much to buy, and each weighed food's cooked yield.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    await ready(v);
    const p = await pantryView(v.workspace.id, v.user.id, v.today);
    if (!p) throw new Error("HumanOS isn't set up for this member yet.");
    const lines: string[] = [];
    lines.push(p.soon.length ? `Use soon: ${p.soon.map((it) => `${it.food?.name ?? "a food"} ${it.qty} ${it.unit} ${it.state} (${it.days < 0 ? "past its date" : it.days === 0 ? "today" : it.days === 1 ? "tomorrow" : `${it.days} days`})`).join("; ")}.` : "Nothing to use soon.");
    lines.push(p.gaps.length ? `To buy: ${p.gaps.map((g) => `${g.short} ${g.unit} ${g.name} (${g.onHand} of ${g.par} on hand)`).join("; ")}.` : "Nothing below par.");
    lines.push(p.items.length ? `On the shelf: ${p.items.map((it) => `${it.food?.name ?? "a food"} ${it.qty} ${it.unit} ${it.state}, ${it.location}${it.useBy ? `, use by ${it.useBy}` : ""}`).join("; ")}.` : "The shelf is empty.");
    const yields = p.yields.filter((y) => y.factor != null);
    if (yields.length) lines.push(`Cooked yields: ${yields.map((y) => `${y.food.name} ${Math.round(y.factor! * 100)}% (${y.source})`).join(", ")}.`);
    return { text: lines.join("\n"), data: { soon: p.soon.map((it) => ({ food: it.food?.name ?? null, qty: it.qty, unit: it.unit, state: it.state, useBy: it.useBy, days: it.days })), toBuy: p.gaps, items: p.items.map((it) => ({ id: it.id, food: it.food?.name ?? null, qty: it.qty, unit: it.unit, state: it.state, location: it.location, boughtOn: it.boughtOn, useBy: it.useBy })), yields: yields.map((y) => ({ food: y.food.name, factor: y.factor, source: y.source })) } };
  },
});

export const bodyUpdatePantry = defineTool({
  name: "body_update_pantry",
  scope: "body",
  kind: "write",
  description: "Change the pantry: add something to the shelf (a food by name, how much, raw or cooked, where, use by), or take some off it outside a logged meal (used up or thrown out), soonest use-by first.",
  input: {
    mode: z.enum(["add", "use"]).describe("add: onto the shelf; use: off it"),
    food: z.string().describe("The food's name"),
    qty: z.number().positive().describe("How much, in the food's unit unless a unit is given"),
    unit: z.string().optional().describe("The unit, when not the food's own"),
    state: z.enum(["raw", "cooked"]).optional().describe("Raw unless said (add only)"),
    location: z.enum(PANTRY_LOCATIONS as [string, ...string[]]).optional().describe("fridge, freezer or pantry (add only)"),
    useBy: z.string().optional().describe("YYYY-MM-DD (add only)"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const lib = await bodyLibrary(v.workspace.id, v.user.id);
    const food = byName("food", lib.foods, String(input.food ?? ""));
    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Give a quantity above zero.");
    const unit = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim().slice(0, 30) : food.unit;
    if (input.mode === "add") {
      const useBy = typeof input.useBy === "string" && DATE.test(input.useBy) ? input.useBy : null;
      const state = input.state === "cooked" ? "cooked" : "raw";
      const location = input.location === "freezer" || input.location === "pantry" ? input.location : "fridge";
      await db.insert(schema.bodyPantry).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, foodId: food.id, qty, unit, state, location, boughtOn: v.today, useBy });
      return { text: `Added ${qty} ${unit} ${food.name} (${state}) to the ${location}${useBy ? `, use by ${useBy}` : ""}.`, data: { added: { food: food.name, qty, unit, state, location, useBy } } };
    }
    const inFood = unit === food.unit ? qty : convertQty(qty, unit, food.unit);
    if (inFood == null) throw new Error(`${food.name} is counted per ${food.unit}; ${unit} doesn't convert.`);
    await consumePantry(v.workspace.id, v.user.id, [{ foodId: food.id, qty: inFood }]);
    const p = await pantryView(v.workspace.id, v.user.id, v.today);
    const left = p?.items.filter((it) => it.foodId === food.id) ?? [];
    return { text: `Took ${qty} ${unit} ${food.name} off the shelf. Left: ${left.length ? left.map((it) => `${it.qty} ${it.unit} ${it.state}`).join(", ") : "none"}.`, data: { used: { food: food.name, qty: inFood, unit: food.unit }, left: left.map((it) => ({ qty: it.qty, unit: it.unit, state: it.state, useBy: it.useBy })) } };
  },
});

/* ───────── The weekly rollup (rev 237 phase 6) ───────── */

export const bodyWeekTool = defineTool({
  name: "body_week",
  scope: "body",
  kind: "read",
  description: "The rollup: this week unless told otherwise. range \"month\", \"90d\" or \"year\" (with an optional from, YYYY-MM-DD) gives the same figures over that span: days logged and in band, average calories, protein against its floor and fat against its ceiling, sessions, sets and PRs, the routines that ran, weight and body fat change, sleep a night and habits kept. For a week: the average weight against last week and how the weight goal is pacing.",
  input: { date: z.string().optional().describe("YYYY-MM-DD in the week wanted; this week when left out"), range: z.enum(["week", "month", "90d", "year"]).optional(), from: z.string().optional().describe("YYYY-MM-DD: the month's day, or the last day of the 90-day or year span") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    if (isRangeKey(input.range) && input.range !== "week") {
      const b = rangeBounds(input.range, typeof input.from === "string" ? input.from : null, v.today, { addDays, startOfWeek });
      const r = await bodyRange(v.workspace.id, v.user.id, b, v.today);
      if (!r) throw new Error("HumanOS isn't set up for this member yet.");
      const u = settings.weightUnit;
      const n = r.nutrition;
      const num = (x: number | null, d = 1) => (x == null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: d }));
      const lines = [`${b.label} (${b.from} to ${b.to}).`];
      lines.push(`Nutrition: ${n.daysLogged} of ${n.daysPassed} days logged${n.daysJudged ? `, ${n.daysInBand} of ${n.daysJudged} finished days in band` : ""}; average ${num(n.avgCal, 0)} cal, ${num(n.avgP)} g protein, ${num(n.avgF)} g fat, ${num(n.avgC)} g carbs.`);
      lines.push(`Training: ${r.training.sessions} sessions, ${r.training.sets} sets, ${r.training.prs} PR${r.training.prs === 1 ? "" : "s"}${r.training.routines.length ? `; routines: ${r.training.routines.map((x) => `${x.name} × ${x.times}`).join(", ")}` : ""}; by week: ${r.training.perWeekSessions.map((w) => `${w.monday} ${w.value ?? 0}`).join(", ")}.`);
      lines.push(r.weigh.last?.values.weight != null ? `Weight: ${fmtMetric("weight", r.weigh.last.values.weight, u)} on ${r.weigh.last.date}${r.weigh.change.weight != null ? `, ${r.weigh.change.weight > 0 ? "+" : ""}${fmtMetric("weight", r.weigh.change.weight, u)} over the range` : ""}${r.weigh.last.values.bf != null ? `, body fat ${fmtMetric("bf", r.weigh.last.values.bf, u)}${r.weigh.change.bf != null ? ` (${r.weigh.change.bf > 0 ? "+" : ""}${r.weigh.change.bf}%)` : ""}` : ""} over ${r.weigh.days} weigh-ins.` : "Weight: no weigh-ins in this range.");
      lines.push(r.sleep.summary.nights ? `Sleep: ${fmtHours(r.sleep.summary.avg!)} a night over ${r.sleep.summary.nights} nights, ${r.sleep.summary.atFloor} at 7 h or more.` : "Sleep: no nights logged.");
      lines.push(r.habits.due ? `Habits: ${rateText(r.habits.kept, r.habits.due)} kept; ${r.habits.habits.map((h) => `${h.name} ${rateText(h.kept, h.due)}${h.best ? `, best run ${h.best}` : ""}`).join("; ")}.` : "Habits: none due.");
      return { text: lines.join("\n"), data: { range: b, nutrition: n, training: { sessions: r.training.sessions, sets: r.training.sets, prs: r.training.prs, routines: r.training.routines, perWeek: r.training.perWeekSessions }, weight: { unit: u, days: r.weigh.days, change: r.weigh.change, last: r.weigh.last?.values ?? null }, sleep: r.sleep.summary, habits: { kept: r.habits.kept, due: r.habits.due, byHabit: r.habits.habits.map((h) => ({ name: h.name, kept: h.kept, due: h.due, best: h.best })) } } };
    }
    const asked = typeof input.date === "string" && DATE.test(input.date) ? startOfWeek(input.date) : startOfWeek(v.today);
    const monday = asked > startOfWeek(v.today) ? startOfWeek(v.today) : asked;
    const w = await bodyWeek(v.workspace.id, v.user.id, monday, v.today);
    if (!w) throw new Error("HumanOS isn't set up for this member yet.");
    const u = settings.weightUnit;
    const n = w.nutrition;
    const num = (x: number | null, d = 1) => (x == null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: d }));
    const lines = [`${w.isCurrent ? "This week" : `Week of ${monday}`} (${monday} to ${w.sunday}).`];
    lines.push(`Nutrition: ${n.daysLogged} of ${n.daysPassed} days logged${n.daysJudged ? `, ${n.daysInBand} of ${n.daysJudged} finished days in band` : ""}; average ${num(n.avgCal, 0)} cal, ${num(n.avgP)} g protein${n.avgPFloor != null ? ` (floor ${num(n.avgPFloor)})` : ""}, ${num(n.avgF)} g fat${n.avgFCeiling != null ? ` (ceiling ${num(n.avgFCeiling)})` : ""}, ${num(n.avgC)} g carbs.`);
    lines.push(`Training: ${w.training.sessions}${w.training.planned != null ? ` of ${w.training.planned}` : ""} sessions, ${w.training.sets} sets, ${w.training.prs} PR${w.training.prs === 1 ? "" : "s"} (last week ${w.prevTraining.sessions} sessions, ${w.prevTraining.sets} sets).`);
    lines.push(w.weigh.avg != null ? `Weight: average ${fmtMetric("weight", w.weigh.avg, u)} over ${w.weigh.days} weigh-in${w.weigh.days === 1 ? "" : "s"}${w.weigh.change != null ? `, ${w.weigh.change > 0 ? "+" : ""}${fmtMetric("weight", w.weigh.change, u)} vs last week` : ""}.` : "Weight: no weigh-ins this week.");
    if (w.pace) lines.push(`Goal: ${fmtMetric("weight", w.pace.target, u)}${w.pace.by ? ` by ${w.pace.by}` : ""}, ${fmtMetric("weight", Math.abs(w.pace.toGo), u)} to go${w.pace.needPerWeek != null ? `, needs ${fmtMetric("weight", Math.abs(w.pace.needPerWeek), u)} a week` : ""}${w.pace.actualPerWeek != null ? `, doing ${w.pace.actualPerWeek > 0 ? "+" : "-"}${fmtMetric("weight", Math.abs(w.pace.actualPerWeek), u)} a week` : ""}: ${w.pace.onPace == null ? "pace unknown yet" : w.pace.onPace ? "on pace" : "behind"}.`);
    return { text: lines.join("\n"), data: { monday, sunday: w.sunday, nutrition: n, prevNutrition: w.prevNutrition, training: w.training, prevTraining: w.prevTraining, weight: { unit: u, avg: w.weigh.avg, days: w.weigh.days, change: w.weigh.change }, pace: w.pace } };
  },
});


/* ── Phase 8: sleep and habits. Never the health log (rev 251): no tool reads that table. ── */

defineTool({
  name: "body_sleep",
  scope: "body",
  kind: "read",
  description: "The member's sleep: last night's hours and score, this week's average against last week's and the nights at 7 hours or more, and the last 14 nights (with bed and wake times and the stages when a wearable gave them). With range (\"month\", \"90d\", \"year\") and an optional from: the nights over that span, the average, nights at 7 h and under, by week. Nothing else of their health.",
  input: { range: z.enum(["week", "month", "90d", "year"]).optional(), from: z.string().optional() },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    if (isRangeKey(input.range)) {
      const b = rangeBounds(input.range, typeof input.from === "string" ? input.from : null, v.today, { addDays, startOfWeek });
      const r = await sleepRange(v.workspace.id, v.user.id, b);
      return { text: r.summary.nights ? `${b.label}: ${fmtHours(r.summary.avg!)} a night over ${r.summary.nights} nights, ${r.summary.atFloor} at 7 h or more, ${r.under} under. By week: ${r.perWeek.map((w) => `${w.monday} ${w.value != null ? fmtHours(w.value) : "—"}`).join(", ")}.` : `${b.label}: no nights logged.`, data: { range: b, summary: r.summary, under: r.under, nights: r.nights, perWeek: r.perWeek } };
    }
    const s = await sleepView(v.workspace.id, v.user.id, v.today);
    if (!s) throw new Error("HumanOS isn't set up for this member yet.");
    const lines = [s.last ? `Last night (${s.last.date}): ${s.last.text}${s.last.score != null ? `, score ${s.last.score}` : ""}.` : "No nights logged yet."];
    if (s.week.avg != null) lines.push(`This week: ${fmtHours(s.week.avg)} a night over ${s.week.nights} night${s.week.nights === 1 ? "" : "s"}, ${s.week.atFloor} at 7 h or more${s.prevWeek.avg != null ? `; last week ${fmtHours(s.prevWeek.avg)}` : ""}.`);
    if (s.recent.length) lines.push(`Nights: ${s.recent.map((n) => `${n.date} ${n.sleep_h != null ? fmtHours(n.sleep_h) : "—"}${n.sleep_score != null ? ` (${n.sleep_score})` : ""}${n.bedtime != null && n.waketime != null ? `, ${fmtBedtime(n.bedtime)} to ${fmtWake(n.waketime)}` : ""}${n.sleep_deep_min != null ? `, deep ${n.sleep_deep_min} min` : ""}${n.sleep_rem_min != null ? `, REM ${n.sleep_rem_min} min` : ""}`).join("; ")}.`);
    return { text: lines.join("\n"), data: { last: s.last, week: s.week, prevWeek: s.prevWeek, nights: s.recent } };
  },
});

defineTool({
  name: "body_log_sleep",
  scope: "body",
  kind: "write",
  description: "Log a night's sleep: hours (7.5 or \"7:30\") and an optional score 0–100, on the morning it ended (today unless a date is given). Logging a night again replaces it.",
  input: { hours: z.union([z.number(), z.string()]).describe("Hours slept: 7.5 or \"7:30\""), score: z.number().min(0).max(100).optional(), date: z.string().optional().describe("YYYY-MM-DD, the morning the night ended; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const date = dayOf(v, input.date);
    const hours = typeof input.hours === "number" && Number.isFinite(input.hours) ? input.hours : parseHours(String(input.hours ?? ""));
    if (hours == null || !recoveryInRange("sleep_h", hours)) throw new Error("Hours slept: give a number of hours like 7.5, or a time like 7:30.");
    const readingId = sleepReadingId(date);
    await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.readingId, readingId), and(eq(schema.bodyDaily.workspaceId, v.workspace.id), eq(schema.bodyDaily.userId, v.user.id))));
    const rows = [{ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, key: "sleep_h", value: Math.round(hours * 100) / 100, source: "manual" as const, readingId, time: null }];
    const score = input.score == null ? null : Number(input.score);
    if (score != null && (!Number.isFinite(score) || !recoveryInRange("sleep_score", score))) throw new Error("A sleep score is 0 to 100.");
    if (score != null) rows.push({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, key: "sleep_score", value: Math.round(score), source: "manual", readingId, time: null });
    await db.insert(schema.bodyDaily).values(rows);
    return { text: `Logged ${fmtHours(hours)}${score != null ? `, score ${Math.round(score)}` : ""} for the night ending ${date === v.today ? "this morning" : date}.`, data: { date, hours: rows[0].value, score } };
  },
});

defineTool({
  name: "body_habits",
  scope: "body",
  kind: "read",
  description: "The member's habits on a day (today unless a date is given): each with its kind, target and days, whether it's due and kept, today's value, its streak, and the week's tally. With range (\"month\", \"90d\", \"year\") and an optional from: kept of due per habit over that span, the kept rate and the best run.",
  input: { date: z.string().optional().describe("YYYY-MM-DD; today when left out"), range: z.enum(["week", "month", "90d", "year"]).optional(), from: z.string().optional() },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    if (isRangeKey(input.range)) {
      const b = rangeBounds(input.range, typeof input.from === "string" ? input.from : null, v.today, { addDays, startOfWeek });
      const r = await habitsRange(v.workspace.id, v.user.id, b, v.today);
      return { text: r.habits.length ? `${b.label}: ${rateText(r.kept, r.due)} kept across every habit.\n${r.habits.map((h) => `${h.name}: ${rateText(h.kept, h.due)}${h.best ? `, best run ${h.best} day${h.best === 1 ? "" : "s"}` : ""}`).join("\n")}` : "No habits yet.", data: { range: b, kept: r.kept, due: r.due, habits: r.habits.map((h) => ({ name: h.name, kept: h.kept, due: h.due, best: h.best })) } };
    }
    const date = dayOf(v, input.date);
    const hd = await habitsDay(v.workspace.id, v.user.id, date, v.today);
    if (!hd.habits.length) return { text: "No habits yet. They pick from the starter list or add their own on Practices.", data: { habits: [], week: hd.week } };
    const line = (h: (typeof hd.habits)[number]) => `${h.name} (${fmtTarget(h) || h.kind}${h.days.length ? `, ${fmtDays(h.days)}` : ""}): ${!h.due ? "not due" : h.kept ? "kept" : h.value != null ? `${h.valueText} so far` : "not yet"}${h.streak ? `, streak ${h.streak}` : ""}`;
    return {
      text: `${date === v.today ? "Today" : date}: ${hd.habits.filter((h) => h.due && h.kept).length} of ${hd.habits.filter((h) => h.due).length} kept; this week ${hd.week.kept} of ${hd.week.due}.\n${hd.habits.map(line).join("\n")}`,
      data: { date, week: hd.week, habits: hd.habits.map((h) => ({ name: h.name, kind: h.kind, unit: h.unit, target: h.target, days: h.days, due: h.due, kept: h.kept, value: h.value, streak: h.streak })) },
    };
  },
});

defineTool({
  name: "body_log_habit",
  scope: "body",
  kind: "write",
  description: "Log a habit by name: a done-or-not habit is ticked (or unticked with done: false); a minutes, count or amount habit takes a value. Today unless a date is given. Positive framing: the reply says what's kept, never what's missed.",
  input: { habit: z.string().describe("The habit's name, as on Practices"), value: z.number().optional().describe("Minutes, count or amount; not needed for a done-or-not habit"), done: z.boolean().optional().describe("For a done-or-not habit: false unticks it"), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const date = dayOf(v, input.date);
    const h = byName("habit", await habitsFor(v.workspace.id, v.user.id, { today: v.today }), String(input.habit ?? ""));
    let value: number | null;
    if (h.kind === "done") value = input.done === false ? null : 1;
    else {
      const n = input.value == null ? NaN : Number(input.value);
      if (!Number.isFinite(n)) throw new Error(`${h.name} counts ${h.kind === "minutes" ? "minutes" : (h.unit ?? "a number")}: give the value.`);
      value = n > 0 && n < 1_000_000 ? n : null;
    }
    const own = and(eq(schema.bodyHabitLogs.workspaceId, v.workspace.id), eq(schema.bodyHabitLogs.userId, v.user.id));
    await db.delete(schema.bodyHabitLogs).where(and(and(eq(schema.bodyHabitLogs.habitId, h.id), eq(schema.bodyHabitLogs.date, date)), own));
    if (value != null) await db.insert(schema.bodyHabitLogs).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, habitId: h.id, date, value, source: "manual" });
    const hd = await habitsDay(v.workspace.id, v.user.id, date, v.today);
    const mine = hd.habits.find((x) => x.id === h.id)!;
    const isKept = kept(h, value);
    return { text: `${h.name}: ${value == null ? "cleared" : `${h.kind === "done" ? "done" : fmtHabitValue(h, value)}${isKept ? " ✓" : h.target != null ? ` (target ${fmtHabitValue(h, h.target)})` : ""}`}${date === v.today ? "" : ` for ${date}`}${mine.streak ? `; streak ${mine.streak} day${mine.streak === 1 ? "" : "s"}` : ""}. ${hd.week.kept} of ${hd.week.due} kept this week.`, data: { date, habit: h.name, value, kept: isKept, streak: mine.streak, week: hd.week } };
  },
});

/* ── Phase 9: the correlation explorer. Plain statistics; the readout's own words, never a cause. ── */

defineTool({
  name: "body_correlation",
  scope: "body",
  kind: "read",
  description: "How two of the member's tracked numbers moved together: sleep, weight, calories, workouts, a habit, or a business number from their daily log (calls booked, cash collected, energy, tasks closed…). Pearson r with the number of paired days; nothing under 21 pairs. Give metric names, or leave both out for the preset list.",
  input: {
    a: z.string().optional().describe("Metric A, e.g. \"sleep hours\" or a habit's name"),
    b: z.string().optional().describe("Metric B, e.g. \"calls booked\""),
    lag: z.number().int().min(0).max(3).optional().describe("Days after A that B is read; 0 by default"),
    window: z.number().int().optional().describe("4, 8 or 12 weeks; 8 by default"),
    grain: z.enum(["daily", "weekly"]).optional(),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const metrics = await insightMetrics(v.workspace.id, v.user.id);
    if (!input.a || !input.b) return { text: `Pick two metrics. Presets: ${PRESETS.map((p) => p.label).join("; ")}. Metrics: ${metrics.map((m) => m.label).join(", ")}.`, data: { presets: PRESETS, metrics: metrics.map((m) => ({ key: m.key, label: m.label, group: m.group })) } };
    const A = byName("metric", metrics.map((m) => ({ ...m, name: m.label })), String(input.a));
    const B = byName("metric", metrics.map((m) => ({ ...m, name: m.label })), String(input.b));
    const grain = input.grain === "weekly" || input.grain === "daily" ? input.grain : A.weeklyByDefault || B.weeklyByDefault ? "weekly" : "daily";
    const r = await correlate(v.workspace.id, v.user.id, v.today, v.tz, { a: A.key, b: B.key, lag: Number(input.lag ?? 0), window: Number(input.window ?? 8), grain, excludeFlagged: false });
    if (!r) throw new Error("Unknown metric.");
    return { text: `${r.verdict.words} Window ${r.window} weeks, ${grain}${r.lag ? `, B read ${r.lag} day${r.lag === 1 ? "" : "s"} after A` : ""}. Moving together is not a cause.`, data: { a: A.key, b: B.key, lag: r.lag, window: r.window, grain, r: r.verdict.r, n: r.verdict.n, early: r.verdict.early, kind: r.verdict.kind, pairs: r.pairs } };
  },
});

/* ── Phase 10: the shopping list, and the push to Instacart, which only ever returns a link (rev 251). ── */

const listText = (view: NonNullable<Awaited<ReturnType<typeof shoppingView>>>) => (view.list.lines.length ? view.list.sections.map((s) => `${s.label}: ${s.lines.map((l) => `${l.name} ${l.toBuy} ${l.unit}${l.why === "par" ? " (below par)" : l.why === "both" ? " (plan and par)" : ""}`).join(", ")}`).join("\n") : "Nothing to buy: the week's plan is covered by the shelf and nothing is below par.");

defineTool({
  name: "body_shopping_list",
  scope: "body",
  kind: "read",
  description: "The member's shopping list this week: the saved meals planned (times each), minus what's on the shelf, plus staples below par, grouped by store section with how much to buy in the food's unit.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    await ready(v);
    const view = await shoppingView(v.workspace.id, v.user.id, v.today);
    if (!view) throw new Error("HumanOS isn't set up for this member yet.");
    const plan = view.planned.length ? `Planned this week: ${view.planned.map((p) => `${p.meal.name} × ${p.times}`).join(", ")}.` : "Nothing planned this week yet (saved meals go on the plan on the Shopping page).";
    return { text: `${plan}\n${listSummary(view.list)}.\n${listText(view)}`, data: { monday: view.monday, planned: view.planned.map((p) => ({ meal: p.meal.name, times: p.times })), lines: view.list.lines } };
  },
});

defineTool({
  name: "push_to_instacart_cart",
  scope: "body",
  kind: "write",
  description: "Send the member's shopping list to Instacart as a shopping-list page and return its link. Ask the member to confirm first, every time. On that page they pick the store, review, add to cart and pay in Instacart themselves; HelixOS never places or pays for an order. Pass confirm: true after they say yes.",
  input: { confirm: z.boolean().describe("true only after the member confirmed sending this list"), skip: z.array(z.string()).optional().describe("Food names to leave off") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const view0 = await shoppingView(v.workspace.id, v.user.id, v.today);
    if (!view0) throw new Error("HumanOS isn't set up for this member yet.");
    const skipNames = new Set((Array.isArray(input.skip) ? input.skip : []).map((x) => String(x).toLowerCase()));
    const skip = new Set(view0.foods.filter((f) => skipNames.has(f.name.toLowerCase())).map((f) => f.id));
    const view = skip.size ? (await shoppingView(v.workspace.id, v.user.id, v.today, skip))! : view0;
    if (!view.list.lines.length) return { text: "Nothing to send: the list is empty.", data: { sent: false } };
    if (input.confirm !== true) return { text: `Not sent. The list is ${listSummary(view.list)}:\n${listText(view)}\nAsk the member to confirm, then call again with confirm: true.`, data: { sent: false, lines: view.list.lines } };
    const lines = instacartLines(view.list.lines);
    const logged = lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit }));
    try {
      const link = await createShoppingListLink("HelixOS shopping list", lines, null);
      await db.insert(schema.bodyOrders).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, lines: logged, link, status: "link", note: null });
      return { text: `Sent ${lines.length} line${lines.length === 1 ? "" : "s"}. Open the link to pick the store, review and pay in Instacart; HelixOS placed nothing: ${link}`, data: { sent: true, link, lines: logged } };
    } catch (e) {
      if (!(e instanceof InstacartError)) throw e;
      await db.insert(schema.bodyOrders).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, lines: logged, link: null, status: "failed", note: e.problem });
      throw new Error(instacartProblem(e));
    }
  },
});

defineTool({
  name: "body_find_food",
  scope: "body",
  kind: "read",
  description: "Look a food up for the member: by words in the USDA food database, or by barcode in Open Food Facts. Returns each match's calories, protein, fat, carbs and sodium per 100 g and per the member's own unit. Nothing is saved: the member saves a result from the Find page on Nutrition.",
  input: { query: z.string().optional().describe("Words to search, e.g. 'chicken breast raw'"), barcode: z.string().optional().describe("The digits under a product's barcode") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const code = input.barcode ? readBarcode(String(input.barcode)) : null;
    if (input.barcode && !code) throw new Error("A barcode is 8 to 14 digits.");
    const q = String(input.query ?? "").trim();
    if (!code && !q) throw new Error("Give words to search, or a barcode.");
    try {
      const found = code ? [await lookupBarcode(code)] : await searchFoods(q, 8);
      if (!found.length) return { text: `Nothing matched "${q}".`, data: { results: [] } };
      const unit = settings.foodUnit;
      const lines = found.map((f) => `${f.name}${f.brand ? ` (${f.brand})` : ""}: ${fmtPer100(f.per100)}`);
      return { text: `${lines.join("\n")}\nTo keep one, the member saves it from Nutrition → Find a food (it lands per ${unit}).`, data: { results: found.map((f) => ({ source: f.source, ref: f.ref, name: f.name, brand: f.brand, per100: f.per100, perUnit: { unit, ...perUnit(f.per100, unit) } })) } };
    } catch (e) {
      if (e instanceof FoodSearchError) throw new Error(foodSearchProblem(e));
      throw e;
    }
  },
});

/* ───────── Setting HumanOS up by voice (Danno, rev 417): foods, meals, habits, exercises, day types. Nothing deletes. ───────── */

const BAND_MACROS = [["cal", "calMin", "calMax"], ["p", "pMin", "pMax"], ["f", "fMin", "fMax"], ["c", "cMin", "cMax"]] as const;
const own = <T extends { workspaceId: unknown; userId: unknown }>(t: T, v: Viewer) => and(eq(t.workspaceId as never, v.workspace.id), eq(t.userId as never, v.user.id));
const sameName = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
type DayTypeRow = schema.BodyDayType;
const bandsText = (t: DayTypeRow) => {
  const parts = BAND_MACROS.flatMap(([m, lo, hi]) => (t[lo] != null && t[hi] != null ? [`${MACRO_LABEL[m]} ${fmtBand(m, { min: t[lo]!, max: t[hi]! })}`] : []));
  return parts.length ? parts.join(", ") : "no bands yet";
};

defineTool({
  name: "body_add_food",
  scope: "body",
  kind: "write",
  description: "Add a food to the member's HumanOS, per one unit: name, unit (oz, g, lb, kg, fl oz, ml, cup, tbsp, tsp, each, slice, piece, scoop, serving, or any other word), calories, protein, fat and carbs per that unit, optional sodium (mg), cap tag, raw or cooked basis, and store section. A name already in their foods is refused and named back, never doubled.",
  input: {
    name: z.string().describe("The food's name"),
    unit: z.string().describe("The 'per' unit: oz, g, lb, kg, fl oz, ml, cup, tbsp, tsp, each, slice, piece, scoop, serving, or another word"),
    cal: z.number().min(0).describe("Calories per unit"),
    p: z.number().min(0).describe("Protein grams per unit"),
    f: z.number().min(0).describe("Fat grams per unit"),
    c: z.number().min(0).describe("Carb grams per unit"),
    sodium: z.number().min(0).optional().describe("Sodium mg per unit"),
    capTag: z.string().optional().describe("A cap tag the member uses, e.g. 'cheese'"),
    basis: z.enum(["cooked", "raw"]).optional().describe("Whether the numbers are for the food cooked (the default) or raw"),
    section: z.enum(schema.FOOD_SECTIONS).optional().describe("Store section for the shopping list"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const name = String(input.name ?? "").trim().slice(0, 80);
    const unit = storedUnit(String(input.unit ?? "")).slice(0, 30);
    if (!name || !unit) throw new Error("A food needs a name and a unit.");
    const nums = [input.cal, input.p, input.f, input.c, input.sodium ?? 0].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) throw new Error(`${name}: calories, macros and sodium are numbers of zero or more.`);
    const foods = await db.query.bodyFoods.findMany({ where: own(schema.bodyFoods, v) });
    const have = sameName(foods.filter((x) => !x.archivedAt), name);
    if (have) throw new Error(`"${have.name}" is already one of their foods (per ${have.unit}: ${fmtMacro("cal", have.cal)} cal, ${fmtMacro("p", have.p)} P, ${fmtMacro("f", have.f)} F, ${fmtMacro("c", have.c)} C). Log it or use it in a meal as it is; changing it is done on Nutrition.`);
    const food = { name, unit, cal: nums[0], p: nums[1], f: nums[2], c: nums[3], sodium: nums[4], capTag: typeof input.capTag === "string" && input.capTag.trim() ? input.capTag.trim().toLowerCase().slice(0, 30) : null, basis: input.basis === "raw" ? ("raw" as const) : ("cooked" as const), section: (schema.FOOD_SECTIONS as readonly string[]).includes(String(input.section)) ? (input.section as schema.FoodSection) : null };
    // An archived food of the same name comes back with these numbers rather than a second row (as the form does for a found food).
    const archived = sameName(foods.filter((x) => x.archivedAt), name);
    if (archived) await db.update(schema.bodyFoods).set({ ...food, archivedAt: null }).where(eq(schema.bodyFoods.id, archived.id));
    else await db.insert(schema.bodyFoods).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, ...food });
    const line = `${name}, per ${unit}: ${fmtMacro("cal", food.cal)} cal, ${fmtMacro("p", food.p)} P, ${fmtMacro("f", food.f)} F, ${fmtMacro("c", food.c)} C${food.sodium ? `, ${food.sodium} mg sodium` : ""}${food.basis === "raw" ? ", raw" : ""}${food.capTag ? `, cap tag ${food.capTag}` : ""}${food.section ? `, ${food.section}` : ""}`;
    return { text: `${archived ? "Brought back" : "Added"} ${line}.`, data: { food: { ...food, restored: !!archived } } };
  },
});

defineTool({
  name: "body_save_meal",
  scope: "body",
  kind: "write",
  description: "Save a meal the member logs in one tap: a name, an optional usual slot, and lines of their own foods by name × quantity in each food's unit. Every food must already exist (add it first with body_add_food). Answers with the meal's totals. A meal name already saved is refused, never overwritten.",
  input: {
    name: z.string().describe("The meal's name"),
    slot: z.string().optional().describe("The usual slot: Breakfast, Lunch, Dinner, Snack, or the member's own"),
    lines: z.array(z.object({ food: z.string().describe("A food's name"), qty: z.number().positive().describe("Quantity in the food's own unit") })).min(1).max(20),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) throw new Error("A meal needs a name.");
    const lib = await bodyLibrary(v.workspace.id, v.user.id);
    const have = sameName(lib.meals, name);
    if (have) throw new Error(`"${have.name}" is already a saved meal. Log it with body_log_meal; changing it is done on Nutrition.`);
    const lines = Array.isArray(input.lines) ? input.lines : [];
    const picked = lines.map((l) => ({ food: byName("food", lib.foods, String(l.food ?? "")), qty: Number(l.qty) }));
    if (!picked.length || picked.some((l) => !Number.isFinite(l.qty) || l.qty <= 0)) throw new Error(`${name}: give each line a food and a quantity above zero.`);
    const slotWord = typeof input.slot === "string" ? input.slot.trim() : "";
    const slotAsked = slotWord ? settings.mealSlots.find((x) => x.toLowerCase() === slotWord.toLowerCase()) ?? null : null;
    if (slotWord && !slotAsked) throw new Error(`Their slots are ${settings.mealSlots.join(", ")}.`);
    const items = picked.map((l) => ({ foodId: l.food.id, qty: Math.round(l.qty * 100) / 100 }));
    await db.insert(schema.bodyMeals).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, name, slot: slotAsked, items });
    const totals = totalsOf(picked.map((l) => entryItem(l.food, l.qty)));
    return { text: `Saved "${name}"${slotAsked ? ` (${slotAsked})` : ""}: ${picked.map((l) => `${l.qty} ${l.food.unit} ${l.food.name}`).join(", ")}. Totals: ${macroLine(totals)}.`, data: { meal: { name, slot: slotAsked, lines: picked.map((l) => ({ food: l.food.name, qty: l.qty, unit: l.food.unit })), totals } } };
  },
});

defineTool({
  name: "body_add_habit",
  scope: "body",
  kind: "write",
  description: "Add a habit to the member's Practices: one of the starters by name (Breathwork, Meditation, Pages read, Stretching, Sauna, Cold exposure, Walk / steps, Water, Electrolytes, Supplements, Sunlight, Journaling, Gratitude, No screens before bed) with its own kind and target, or their own with kind (done, minutes, count, amount), unit, target and days (0 = Sunday … 6 = Saturday; none = every day). A habit already active is refused; an archived one of that name comes back.",
  input: {
    name: z.string().describe("A starter's name, or the member's own"),
    kind: z.enum(schema.HABIT_KINDS).optional().describe("done (a tick), minutes, count, or amount; a starter's own when left out"),
    unit: z.string().optional().describe("For a count or an amount: steps, oz, pages…"),
    target: z.number().positive().optional().describe("The daily target for minutes, a count or an amount"),
    days: z.array(z.number().int().min(0).max(6)).optional().describe("Weekdays it's due, 0 = Sunday; every day when left out"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const asked = String(input.name ?? "").trim().slice(0, 60);
    if (!asked) throw new Error("A habit needs a name.");
    const starter = sameName(STARTER_HABITS, asked);
    const name = starter?.name ?? asked;
    const kind = (input.kind ?? starter?.kind ?? "done") as schema.HabitKind;
    const unitRaw = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim().slice(0, 12) : starter?.unit ?? null;
    const unit = kind === "count" || kind === "amount" ? unitRaw : null;
    const t = input.target != null ? Number(input.target) : starter?.target ?? null;
    const target = kind === "done" || t == null || !(t > 0) ? null : t;
    const days = daysFrom(Array.isArray(input.days) ? input.days.map(Number) : []);
    const have = await db.query.bodyHabits.findMany({ columns: { id: true, name: true, archivedAt: true }, where: own(schema.bodyHabits, v) });
    const same = sameName(have, name);
    if (same && !same.archivedAt) throw new Error(`"${same.name}" is already one of their habits. Log it with body_log_habit; changing it is done on Practices.`);
    if (same) await db.update(schema.bodyHabits).set({ archivedAt: null, kind, unit, target, days }).where(eq(schema.bodyHabits.id, same.id));
    else await db.insert(schema.bodyHabits).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, name, kind, unit, target, days, order: have.length });
    const habit = { name, kind, unit, target, days };
    return { text: `${same ? "Brought back" : "Added"} ${name}: ${fmtTarget(habit) || KIND_LABEL[kind]}, ${fmtDays(days)}${same ? " (its earlier logs are still there)" : ""}.`, data: { habit: { ...habit, restored: !!same } } };
  },
});

defineTool({
  name: "body_add_exercise",
  scope: "body",
  kind: "write",
  description: "Add an exercise to the member's Training: name and kind (weight, or bodyweight). With a routine named, it is also added to the end of that routine with sets (3 unless said) and reps. An exercise already there is not doubled: it is the one put on the routine, or refused when no routine is named.",
  input: {
    name: z.string().describe("The exercise's name"),
    kind: z.enum(["weight", "bodyweight"]).optional().describe("weight (the default) or bodyweight"),
    routine: z.string().optional().describe("A routine's name to add it to"),
    sets: z.number().int().min(1).max(20).optional(),
    reps: z.string().optional().describe("Reps as the member writes them: 8, 8-10, AMRAP"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!name) throw new Error("An exercise needs a name.");
    const lib = await trainingLibrary(v.workspace.id, v.user.id);
    const routine = typeof input.routine === "string" && input.routine.trim() ? byName("routine", lib.routines, input.routine) : null;
    const existing = sameName(lib.exercises, name);
    if (existing && !routine) throw new Error(`"${existing.name}" is already one of their exercises. Name a routine to put it on, or log a set with body_log_set.`);
    let exercise = existing;
    if (!exercise) {
      const id = newId();
      await db.insert(schema.bodyExercises).values({ id, workspaceId: v.workspace.id, userId: v.user.id, name, kind: input.kind === "bodyweight" ? "bodyweight" : "weight" });
      exercise = (await db.query.bodyExercises.findFirst({ where: eq(schema.bodyExercises.id, id) }))!;
    }
    let onRoutine = "";
    if (routine) {
      if (routine.items.length >= 20) throw new Error(`${routine.name} already has twenty exercises, the most.`);
      if (routine.items.some((i) => i.exerciseId === exercise!.id)) throw new Error(`${exercise.name} is already on ${routine.name}.`);
      const sets = Math.min(20, Math.max(1, Math.round(Number(input.sets ?? 3)) || 3));
      const reps = typeof input.reps === "string" ? input.reps.trim().slice(0, 20) : "";
      await db.update(schema.bodyRoutines).set({ items: [...routine.items, { exerciseId: exercise.id, sets, reps }] }).where(and(eq(schema.bodyRoutines.id, routine.id), own(schema.bodyRoutines, v)));
      onRoutine = ` and put it on ${routine.name} as line ${routine.items.length + 1}: ${sets} × ${reps || "?"}`;
    }
    return { text: `${existing ? `Used ${exercise.name}` : `Added ${exercise.name} (${exercise.kind})`}${onRoutine}.`, data: { exercise: { name: exercise.name, kind: exercise.kind, created: !existing }, routine: routine ? routine.name : null } };
  },
});

defineTool({
  name: "body_day_types",
  scope: "body",
  kind: "read",
  description: "The member's day types with each one's bands (calories, protein, fat, carbs as from–to) and reminder, which day type each weekday runs, and the day type of a date (today unless a date is given) and whether it was set by hand.",
  input: { date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = typeof input.date === "string" && DATE.test(input.date) ? input.date : v.today;
    const [types, day] = await Promise.all([dayTypesFor(v.workspace.id, v.user.id), db.query.bodyDays.findFirst({ where: and(own(schema.bodyDays, v), eq(schema.bodyDays.date, date)) })]);
    const nameOf = new Map(types.map((t) => [t.id, t.name]));
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const week = [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]} ${nameOf.get(settings.weekPattern[String(d) as keyof typeof settings.weekPattern] ?? "") ?? "—"}`);
    const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
    const typeId = dayTypeIdFor(date, settings.weekPattern, refeed, day?.dayTypeId ?? null);
    const lines = types.map((t) => `${t.name}: ${bandsText(t)}${t.reminder ? ` · "${t.reminder}"` : ""}`);
    return {
      text: `${lines.join("\n")}\nWeek: ${week.join(", ")}.\n${date === v.today ? "Today" : date} is ${nameOf.get(typeId ?? "") ?? "no day type"}${day?.dayTypeId ? " (set by hand)" : ""}.`,
      data: { dayTypes: types.map((t) => ({ name: t.name, bands: Object.fromEntries(BAND_MACROS.map(([m, lo, hi]) => [m, t[lo] != null && t[hi] != null ? { min: t[lo], max: t[hi] } : null])), reminder: t.reminder })), week: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [DAYS[d], nameOf.get(settings.weekPattern[String(d) as keyof typeof settings.weekPattern] ?? "") ?? null])), date, dayType: nameOf.get(typeId ?? "") ?? null, setByHand: !!day?.dayTypeId },
    };
  },
});

defineTool({
  name: "body_set_day_type",
  scope: "body",
  kind: "write",
  description: "Change one of the member's day types or one date. With bands: set a macro's band on a day type, from and to together (a band is both ends or neither; give min and max), and answers with what it replaced. With a date: run that date as the named day type (a swapped lift day, an unplanned refeed). Nothing is deleted; clearing a band or a date's hand-set type is done on the page.",
  input: {
    dayType: z.string().describe("The day type's name"),
    bands: z.object({ cal: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional(), p: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional(), f: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional(), c: z.object({ min: z.number().min(0), max: z.number().min(0) }).optional() }).optional().describe("Bands to set on this day type, each a from and a to"),
    date: z.string().optional().describe("YYYY-MM-DD: run this date as the day type"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const types = await dayTypesFor(v.workspace.id, v.user.id);
    const t = byName("day type", types, String(input.dayType ?? ""));
    const bands = input.bands && typeof input.bands === "object" ? input.bands : {};
    const asked = BAND_MACROS.filter(([m]) => (bands as Record<string, unknown>)[m] != null);
    const date = typeof input.date === "string" && input.date.trim() ? input.date.trim() : null;
    if (!asked.length && !date) throw new Error("Give bands to set, a date to run as this day type, or both.");
    const said: string[] = [];
    if (asked.length) {
      const set: Partial<Record<(typeof BAND_MACROS)[number][1 | 2], number>> = {};
      for (const [m, lo, hi] of asked) {
        const b = (bands as Record<string, { min: number; max: number }>)[m];
        const min = Number(b.min);
        const max = Number(b.max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error(`${t.name}: give ${MACRO_LABEL[m]} both a from and a to.`);
        if (min < 0 || max < min) throw new Error(`${t.name}: ${MACRO_LABEL[m]}'s top can't be under its bottom.`);
        set[lo] = min;
        set[hi] = max;
        said.push(`${MACRO_LABEL[m]} ${fmtBand(m, { min, max })} (was ${t[lo] != null && t[hi] != null ? fmtBand(m, { min: t[lo]!, max: t[hi]! }) : "no band"})`);
      }
      await db.update(schema.bodyDayTypes).set(set).where(and(eq(schema.bodyDayTypes.id, t.id), own(schema.bodyDayTypes, v)));
    }
    let dayLine = "";
    if (date) {
      if (!DATE.test(date)) throw new Error("A date is YYYY-MM-DD.");
      const existing = await db.query.bodyDays.findFirst({ where: and(own(schema.bodyDays, v), eq(schema.bodyDays.date, date)) });
      const before = existing?.dayTypeId ? types.find((x) => x.id === existing.dayTypeId)?.name ?? null : null;
      if (existing) await db.update(schema.bodyDays).set({ dayTypeId: t.id }).where(eq(schema.bodyDays.id, existing.id));
      else await db.insert(schema.bodyDays).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, dayTypeId: t.id });
      dayLine = `${date} now runs as ${t.name}${before ? ` (was set to ${before} by hand)` : " (was the week's pattern)"}.`;
    }
    return { text: [said.length ? `${t.name}: ${said.join("; ")}.` : "", dayLine].filter(Boolean).join("\n"), data: { dayType: t.name, bands: said, date } };
  },
});
