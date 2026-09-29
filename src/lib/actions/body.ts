"use server";

/**
 * Body writes (rev 179). Every write is the signed-in member's own, keyed by their workspace and user id, except a coach's day
 * comment, which needs the member's share switch on at the moment it's written. No Body value is ever logged.
 */
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, num, opt, optNum, refresh, str } from "@/lib/action-helpers";
import { requireCoach, type Viewer } from "@/lib/auth";
import { MACROS, portionMacros, sumMacros, type Macro } from "@/lib/engine/body";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { bodyAccess, bodySettingsFor, isWorkspaceOwner } from "@/lib/queries/body";
import { logSync } from "@/lib/integrations";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const back = (path: string, error: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);

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

/* ───────── The owner's beta switch ───────── */

/**
 * "Show Body (beta) for me" (rev 209, item 4): the workspace owner turns Body on or off for their own membership, from Settings,
 * because the flag script needs production's database. Nobody else can: not a client, not another coach, not for anyone else.
 * Every change is logged. Not behind the Body flag: it is the flag.
 */
export async function setBodyBetaAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  if (!(await isWorkspaceOwner(v))) redirect("/settings");
  const on = str(formData, "on") === "1";
  if (on === v.membership.bodyEnabled) return refresh();
  await db.update(schema.memberships).set({ bodyEnabled: on }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, v.user.id)));
  await logSync({ workspaceId: v.workspace.id, userId: v.user.id, provider: "account", direction: "in", event: on ? "body.beta_on" : "body.beta_off", status: "received", note: `Body (beta) switched ${on ? "on" : "off"} by the workspace owner on Settings` });
  refresh();
}

/* ───────── Setup ───────── */

/**
 * First visit: the blank skeleton (rev 192), the same for every member, Danno included. One day type, "Every day", with no bands
 * until the member enters them; the four common slots; no floors, caps, refeed, foods or meals. The member fills it in from the
 * checklist on /body. Once only.
 */
export async function setupBodyAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  enabled(v);
  if (await bodySettingsFor(workspaceId, userId)) redirect("/body");
  const everyDay = newId();
  await db.batch([
    db.insert(schema.bodySettings).values({ id: newId(), workspaceId, userId, weekPattern: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), everyDay])) }),
    db.insert(schema.bodyDayTypes).values({ id: everyDay, workspaceId, userId, name: "Every day", order: 0 }),
  ]);
  refresh();
  redirect("/body");
}

/* ───────── Settings ───────── */

export async function saveBodySettingsAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const settings = await setUp(v);
  const types = await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) });
  const typeIds = new Set(types.map((t) => t.id));
  const typeOrNull = (v: string) => (typeIds.has(v) ? v : null);
  const anchor = str(formData, "refeedAnchor");
  if (anchor && !DATE.test(anchor)) back("/body/settings", "The next refeed needs a date.");
  const every = Math.round(num(formData, "refeedEveryDays"));
  const slots = str(formData, "mealSlots").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const caps: schema.BodyCap[] = [];
  for (let i = 0; i < 10; i++) {
    const tag = str(formData, `cap_${i}_tag`).toLowerCase();
    if (!tag) continue;
    const soft = num(formData, `cap_${i}_soft`);
    const hard = num(formData, `cap_${i}_hard`);
    if (hard < soft) back("/body/settings", `The ${tag} cap's flex top can't be under its default.`);
    caps.push({ tag, label: str(formData, `cap_${i}_label`) || tag, unit: str(formData, `cap_${i}_unit`) || "oz", soft, hard });
  }
  await db
    .update(schema.bodySettings)
    .set({
      weightUnit: str(formData, "weightUnit") === "kg" ? "kg" : "lb",
      foodUnit: str(formData, "foodUnit") === "g" ? "g" : "oz",
      calFloor: optNum(formData, "calFloor"),
      fatFloor: optNum(formData, "fatFloor"),
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
}

/** "Let my coach see my Body data": on or off, logged either way. */
export async function setBodyShareAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const settings = await setUp(v);
  const shared = str(formData, "shared") === "1";
  if (shared === settings.shareWithCoach) return refresh();
  await db.batch([
    db.update(schema.bodySettings).set({ shareWithCoach: shared, updatedAt: nowIso() }).where(eq(schema.bodySettings.id, settings.id)),
    db.insert(schema.bodyShareEvents).values({ id: newId(), workspaceId, userId, shared }),
  ]);
  refresh();
}

/* ───────── Day types ───────── */

export async function saveDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 60);
  if (!name) back("/body/settings", "A day type needs a name.");
  // A band is both ends or neither: a macro left blank has no band yet (shown as a total, unmarked).
  const bands = { calMin: optNum(formData, "calMin"), calMax: optNum(formData, "calMax"), pMin: optNum(formData, "pMin"), pMax: optNum(formData, "pMax"), fMin: optNum(formData, "fMin"), fMax: optNum(formData, "fMax"), cMin: optNum(formData, "cMin"), cMax: optNum(formData, "cMax") };
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
}

/** A day type goes; days set to it fall back to the pattern, and the pattern and refeed rule forget it. The last one stays. */
export async function deleteDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
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
}

/** Set one date's day type by hand (a swapped lift day, an unplanned refeed), or clear it back to the pattern. */
export async function setBodyDayTypeAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  const date = str(formData, "date");
  if (!DATE.test(date)) return;
  const typeId = str(formData, "dayTypeId");
  const types = await db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)) });
  const existing = await db.query.bodyDays.findFirst({ where: and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), eq(schema.bodyDays.date, date)) });
  if (!typeId || !types.some((t) => t.id === typeId)) {
    if (existing) await db.delete(schema.bodyDays).where(eq(schema.bodyDays.id, existing.id));
  } else if (existing) await db.update(schema.bodyDays).set({ dayTypeId: typeId }).where(eq(schema.bodyDays.id, existing.id));
  else await db.insert(schema.bodyDays).values({ id: newId(), workspaceId, userId, date, dayTypeId: typeId });
  refresh();
}

/* ───────── Foods and meals ───────── */

export async function saveFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  const unit = str(formData, "unit").slice(0, 30);
  if (!name || !unit) back("/body/foods", "A food needs a name and a unit (oz, egg, scoop…).");
  const food = { name, unit, cal: num(formData, "cal"), p: num(formData, "p"), f: num(formData, "f"), c: num(formData, "c"), capTag: opt(formData, "capTag")?.toLowerCase() ?? null };
  if ([food.cal, food.p, food.f, food.c].some((n) => n < 0)) back("/body/foods", `${name}: macros can't be negative.`);
  if (id) await db.update(schema.bodyFoods).set(food).where(and(eq(schema.bodyFoods.id, id), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))));
  else await db.insert(schema.bodyFoods).values({ id: newId(), workspaceId, userId, ...food });
  refresh();
}

/** Archived foods leave the picker; meals and past days that use them keep working. */
export async function archiveFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  await db.update(schema.bodyFoods).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyFoods.id, str(formData, "id")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))));
  refresh();
}

/** A meal's items come as item_<n>_food / item_<n>_qty pairs; a blank food or a zero quantity drops the row. */
export async function saveMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  const id = str(formData, "id");
  const name = str(formData, "name").slice(0, 80);
  if (!name) back("/body/foods", "A meal needs a name.");
  const foods = await db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)) });
  const known = new Set(foods.map((f) => f.id));
  const items: schema.BodyMealItem[] = [];
  for (let i = 0; i < 20; i++) {
    const foodId = str(formData, `item_${i}_food`);
    const qty = num(formData, `item_${i}_qty`);
    if (known.has(foodId) && qty > 0) items.push({ foodId, qty });
  }
  if (!items.length) back("/body/foods", `${name}: add at least one food with a quantity.`);
  const slot = opt(formData, "slot");
  if (id) await db.update(schema.bodyMeals).set({ name, slot, items }).where(and(eq(schema.bodyMeals.id, id), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))));
  else await db.insert(schema.bodyMeals).values({ id: newId(), workspaceId, userId, name, slot, items });
  refresh();
}

export async function archiveMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  await db.update(schema.bodyMeals).set({ archivedAt: nowIso() }).where(and(eq(schema.bodyMeals.id, str(formData, "id")), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))));
  refresh();
}

/* ───────── Logging ───────── */

function entryItem(food: schema.BodyFood, qty: number): schema.BodyEntryItem {
  return { foodId: food.id, name: food.name, unit: food.unit, qty, cal: food.cal, p: food.p, f: food.f, c: food.c, capTag: food.capTag };
}
const totalsOf = (items: schema.BodyEntryItem[]) => sumMacros(items.map((i) => portionMacros(i)));

function logTarget(formData: FormData, slots: string[]) {
  const date = str(formData, "date");
  const slot = str(formData, "slot");
  if (!DATE.test(date)) back("/body", "That date isn't valid.");
  return { date, slot: slots.includes(slot) ? slot : slot.slice(0, 30) || slots[0] || "Meal" };
}

/** One tap on a saved meal: its default quantities, or the adjusted ones (qty_<n>, per item in order) when opened. */
export async function logMealAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const settings = await setUp(v);
  const { date, slot } = logTarget(formData, settings.mealSlots);
  const meal = await db.query.bodyMeals.findFirst({ where: and(eq(schema.bodyMeals.id, str(formData, "mealId")), and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId))) });
  if (!meal) return;
  const foods = await db.query.bodyFoods.findMany({ where: and(and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)), inArray(schema.bodyFoods.id, meal.items.map((i) => i.foodId))) });
  const byId = new Map(foods.map((f) => [f.id, f]));
  const items = meal.items.flatMap((i, n) => {
    const food = byId.get(i.foodId);
    const adjusted = optNum(formData, `qty_${n}`);
    const qty = adjusted !== null && adjusted >= 0 ? adjusted : i.qty;
    return food && qty > 0 ? [entryItem(food, qty)] : [];
  });
  if (!items.length) return;
  await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId, userId, date, slot, name: meal.name, mealId: meal.id, items, ...totalsOf(items) });
  refresh();
}

/** A food × a quantity. */
export async function logFoodAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const settings = await setUp(v);
  const { date, slot } = logTarget(formData, settings.mealSlots);
  const food = await db.query.bodyFoods.findFirst({ where: and(eq(schema.bodyFoods.id, str(formData, "foodId")), and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId))) });
  const qty = num(formData, "qty");
  if (!food) back(`/body?date=${date}`, "Pick a food.");
  if (!(qty > 0)) back(`/body?date=${date}`, "Give a quantity above zero.");
  const items = [entryItem(food!, qty)];
  await db.insert(schema.bodyEntries).values({ id: newId(), workspaceId, userId, date, slot, name: food!.name, mealId: null, items, ...totalsOf(items) });
  refresh();
}

export async function deleteEntryAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await setUp(v);
  await db.delete(schema.bodyEntries).where(and(eq(schema.bodyEntries.id, str(formData, "id")), and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId))));
  refresh();
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
}

/* ───────── Delete all ───────── */

/**
 * Every Body row of the member's, gone, after typing DELETE. The rest of their HelixOS is untouched. Not behind the Body flag on
 * purpose: deleting your own data is always allowed, even if Body is later switched off for you.
 */
export async function eraseBodyAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  if (str(formData, "confirm").toUpperCase() !== "DELETE") back("/body/settings", "Nothing was deleted: type DELETE to confirm.");
  await db.batch([
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
