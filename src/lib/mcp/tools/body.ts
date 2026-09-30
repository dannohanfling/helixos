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
import { MACROS, MACRO_LABEL, MARK_ICON, entryItem, fmtBand, fmtMacro, slotNow, totalsOf, type Macro, type Macros } from "@/lib/engine/body";
import { convertQty, loggableUnits } from "@/lib/engine/body-units";
import { fmtSet } from "@/lib/engine/body-training";
import { METRIC, fmtMetric, inRange, readTime, storedValue, type MetricKey } from "@/lib/engine/body-scale";
import { bodyDay, bodyLibrary, bodySettingsFor, canAiUseBody, dayComposition, exerciseHistory, latestComposition, trainingDay, trainingLibrary, trainingWeeks, weighIns } from "@/lib/queries/body";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Body's own switch, again, then the member's settings: no settings means Body isn't set up, and every tool says so. */
async function ready(v: Viewer): Promise<schema.BodySettings> {
  if (!(await canAiUseBody(v, v.user.id))) throw new Error("Body's AI switch is off for this member, so Body tools do nothing. They can turn it on in Body settings.");
  const settings = await bodySettingsFor(v.workspace.id, v.user.id);
  if (!settings) throw new Error("Body isn't set up for this member yet: they start it from the Log page.");
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
  description: "The member's Body day: the day type and its targets, what they've eaten with the totals and marks, what's left, which saved meals fit, caps and sodium, the latest weigh-in, and the day's workout. Today unless a date (YYYY-MM-DD) is given.",
  input: { date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const settings = await ready(v);
    const date = dayOf(v, input.date);
    const [d, t, figure] = await Promise.all([bodyDay(v.workspace.id, v.user.id, date, v.today), trainingDay(v.workspace.id, v.user.id, date), dayComposition(v.workspace.id, v.user.id, date)]);
    if (!d) throw new Error("Body isn't set up for this member yet.");
    const lines = [`${date === v.today ? "Today" : date}${d.dayType ? `, a ${d.dayType.name}` : ""}${d.dayType?.reminder ? ` (reminder: ${d.dayType.reminder})` : ""}.`];
    lines.push(d.bands ? `Targets: ${MACROS.filter((m) => d.bands![m]).map((m) => `${fmtBand(m, d.bands![m]!)} ${MACRO_LABEL[m]}`).join(", ")}.` : "No targets set for this day type yet.");
    lines.push(d.entries.length ? `Eaten: ${d.entries.map((e) => `${e.slot}: ${e.name} (${macroLine({ cal: e.cal, p: e.p, f: e.f, c: e.c })})`).join("; ")}.` : "Nothing logged yet.");
    if (d.entries.length) lines.push(`Total: ${macroLine(d.totals)}${d.marks ? ` (${MACROS.filter((m) => d.marks![m]).map((m) => `${MACRO_LABEL[m]} ${MARK_ICON[d.marks![m]!]}`).join(", ")})` : ""}.`);
    if (d.left && !d.final) lines.push(`Left: ${leftText(d.left)}.`);
    if (d.fits.length) lines.push(`Saved meals that fit what's left: ${d.fits.map((f) => f.name).join(", ")}.`);
    if (d.caps.length) lines.push(`Caps: ${d.caps.map((c) => `${c.label} ${c.used} of ${c.soft}${c.hard > c.soft ? ` (hard ${c.hard})` : ""} ${c.unit}`).join("; ")}.`);
    if (d.sodium) lines.push(`Sodium: ${Math.round(d.sodium).toLocaleString("en-US")} mg.`);
    const latest = figure ?? (await latestComposition(v.workspace.id, v.user.id));
    if (latest?.values.weight != null) lines.push(`${latest.date === date ? "Weigh-in" : `Latest weigh-in (${latest.date})`}: ${fmtMetric("weight", latest.values.weight, settings.weightUnit)}${latest.values.bf != null ? `, ${fmtMetric("bf", latest.values.bf, settings.weightUnit)} body fat` : ""}.`);
    if (t?.off) lines.push("Training: marked Off.");
    else if (t?.session) lines.push(`Training: ${t.routineName ?? "a workout"}${t.plan.plannedSets ? `, ${t.plan.doneSets} of ${t.plan.plannedSets} planned sets` : `, ${t.plan.doneSets} sets`}${t.completedAt ? ", finished" : ""}: ${t.exercises.filter((x) => x.today.length).map((x) => `${x.exercise.name} ${x.today.map((s) => fmtSet(s, t.unit, x.exercise.kind)).join(", ")}`).join("; ") || "no sets yet"}.`);
    else if (t?.suggested) lines.push(`Training: ${t.suggested.name} is on the plan for this day type, not started.`);
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
  input: { days: z.number().int().min(7).max(365).optional().describe("How many days back for the trend; 30 when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    const days = typeof input.days === "number" ? Math.min(365, Math.max(7, Math.round(input.days))) : 30;
    const w = await weighIns(v.workspace.id, v.user.id, v.today, days);
    if (!w) throw new Error("Body isn't set up for this member yet.");
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
  input: { exercise: z.string().optional().describe("An exercise name for its history; leave out for the day"), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    await ready(v);
    if (typeof input.exercise === "string" && input.exercise.trim()) {
      const lib = await trainingLibrary(v.workspace.id, v.user.id);
      const ex = byName("exercise", lib.exercises, input.exercise);
      const h = await exerciseHistory(v.workspace.id, v.user.id, ex.id);
      if (!h) throw new Error("Body isn't set up for this member yet.");
      const sessions = h.sessions.slice(0, 12).map((s) => `${s.date}: ${s.sets.map((x) => `${x.text}${x.pr ? " (PR)" : ""}`).join(", ")}`);
      return { text: `${ex.name}${h.pr ? `, PR ${h.pr.text} on ${h.pr.date}` : ", no sets yet"}.\n${sessions.join("\n")}`, data: { exercise: ex.name, kind: ex.kind, unit: h.unit, pr: h.pr, points: h.points, sessions: h.sessions.slice(0, 12) } };
    }
    const date = dayOf(v, input.date);
    const [t, weeks] = await Promise.all([trainingDay(v.workspace.id, v.user.id, date), trainingWeeks(v.workspace.id, v.user.id, v.today)]);
    if (!t) throw new Error("Body isn't set up for this member yet.");
    const lines: string[] = [];
    if (t.off) lines.push(`${date === v.today ? "Today" : date} is marked Off.`);
    else if (t.session) lines.push(`${date === v.today ? "Today" : date}: ${t.routineName ?? "a workout"}${t.plan.plannedSets ? `, ${t.plan.doneSets} of ${t.plan.plannedSets} planned sets` : `, ${t.plan.doneSets} sets`}${t.completedAt ? `, finished${t.note ? ` ("${t.note}")` : ""}` : ""}.`);
    else lines.push(`${date === v.today ? "Today" : date}: no workout started${t.suggested ? `; ${t.suggested.name} is on the plan for this day type` : ""}.`);
    for (const x of t.exercises) lines.push(`${x.exercise.name}${x.target ? ` (plan ${x.target.sets} × ${x.target.reps || "?"})` : ""}: ${x.today.length ? x.today.map((s) => `${fmtSet(s, t.unit, x.exercise.kind)}${s.pr ? " (PR)" : ""}`).join(", ") : "no sets yet"}${x.last.length ? `; last time ${x.lastDate}: ${x.last.join(", ")}` : ""}${x.pr ? `; PR ${x.pr.text}` : ""}.`);
    if (weeks) lines.push(`This week: ${weeks.tally.done}${weeks.tally.planned != null ? ` of ${weeks.tally.planned}` : ""} session${weeks.tally.done === 1 && weeks.tally.planned == null ? "" : "s"}.`);
    return { text: lines.join("\n"), data: { date, off: t.off, routine: t.routineName, finished: !!t.completedAt, plan: t.plan, exercises: t.exercises.map((x) => ({ name: x.exercise.name, kind: x.exercise.kind, target: x.target, today: x.today.map((s) => ({ weight: s.weight, unit: s.unit, reps: s.reps, pr: s.pr })), last: x.last, pr: x.pr })), week: weeks?.tally ?? null } };
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
    return { text: `Logged ${meal.name} to ${slot}${date === v.today ? "" : ` on ${date}`}: ${macroLine(totalsOf(items))}.\n${await dayAfter(v, date)}`, data: { logged: { name: meal.name, slot, date, totals: totalsOf(items) } } };
  },
});

export const bodyLogFood = defineTool({
  name: "body_log_food",
  scope: "body",
  kind: "write",
  description: "Log one of the member's foods by name × a quantity, in the food's own unit or another of the same kind (oz, g, lb, kg; cup, tbsp, tsp, fl oz, ml), into a slot. Today unless a date is given. Answers with the day's totals and what's left.",
  input: { food: z.string().describe("The food's name"), qty: z.number().positive().describe("How much"), unit: z.string().optional().describe("The unit typed, when not the food's own"), slot: z.string().optional(), date: z.string().optional().describe("YYYY-MM-DD; today when left out") },
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
    const items = [entryItem(food, qty)];
    const slot = slotFor(settings.mealSlots, input.slot, v.hour, null);
    await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId: v.workspace.id, userId: v.user.id, date, slot, name: food.name, mealId: null, items, ...totalsOf(items) });
    return { text: `Logged ${typed} ${unit} ${food.name}${unit !== food.unit ? ` (${qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${food.unit})` : ""} to ${slot}${date === v.today ? "" : ` on ${date}`}: ${macroLine(totalsOf(items))}.\n${await dayAfter(v, date)}`, data: { logged: { name: food.name, qty, unit: food.unit, slot, date, totals: totalsOf(items) } } };
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
    return { text: `Logged ${exercise.name} ${fmtSet({ weight, unit: settings.weightUnit, reps }, settings.weightUnit, exercise.kind)}${x ? ` (set ${x.today.length}${x.target ? ` of ${x.target.sets} planned` : ""} ${date === v.today ? "today" : `on ${date}`})` : ""}${set?.pr ? ". A new PR!" : x?.pr ? `. PR stays ${x.pr.text}.` : "."}${session.completedAt ? " The session was finished; it's open again." : ""}`, data: { exercise: exercise.name, date, weight, unit: settings.weightUnit, reps, pr: !!set?.pr, setsToday: x?.today.length ?? 1 } };
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
