/**
 * Body (handoff rev 179, B1, blank start per rev 192, shipped dark per rev 195). First, a client whose Body is off finds none of it:
 * no nav entry, a 404 on every Body page and on the Body export, no Today line, nothing on the coach's side. Then the flag goes
 * on through scripts/body-flag.ts (dry run first, which changes nothing). At phone width, the client sets Body up and gets the blank skeleton: one
 * "Every day" type with no bands, no foods, no meals, and the fill-in checklist. They fill it in through the app with Danno's
 * Phase 2 V4 numbers (the test fixture, typed in as a member would), log his staples, and see the marks and what fits. Then the
 * privacy rule end to end: the coach sees nothing until the client shares, reads and comments while shared, sees nothing again once
 * revoked, and a coach's export never carries Body. Last, delete-all removes every Body row. Every expected value is read from
 * the engine, the fixture or the record, never typed. Run with the dev server up.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import type { Column } from "drizzle-orm";

const base = process.argv[2] ?? "http://localhost:3000";
const PHONE = { width: 390, height: 844 };

async function login(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function loginCoach(page: Page) {
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
/**
 * Press a form's button, wait for its action to answer, then for the page to show the result: the refreshed page lands a beat
 * after the action's response, so a read straight after the POST can see the old page.
 */
async function press(page: Page, selector: string, shown: () => Promise<boolean>, what: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  for (let i = 0; i < 100; i++) {
    if (await shown()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`after pressing, the page shows ${what}`);
}
/**
 * Opens a Disclosure by its summary text, only if it isn't already open. The page streams: wait for the summary to exist before
 * reading whether its form shows, or a click on a Disclosure that renders open shuts it.
 */
async function openDisclosure(page: Page, summary: string, inside: string) {
  const sum = page.locator("summary", { hasText: summary });
  await sum.waitFor({ timeout: 30000 });
  const field = page.locator(`${inside} input[name="name"]`).first();
  if (!(await field.isVisible())) await sum.click();
  await field.waitFor({ state: "visible", timeout: 10000 });
}
const entryCount = (page: Page) => page.locator('[data-testid="body-entry"]').count();
async function noSideScroll(page: Page, where: string) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (sw > cw + 1) throw new Error(`${where}: the page scrolls sideways at phone width (${sw} > ${cw})`);
}
/** A fill checked after typing: a fill that lands mid-hydration inserts at the caret instead of replacing (smoke.sh conventions). */
async function fillExact(page: Page, selector: string, value: string) {
  const el = page.locator(selector).first();
  for (let i = 0; i < 5; i++) {
    await el.fill(value);
    if ((await el.inputValue()) === value) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${selector} holds "${value}"`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { PHASE2_V4 } = await import("../src/lib/engine/__tests__/fixtures/body-phase2v4");
  const { dayMarks, MACROS, fmtMacro, portionMacros, sumMacros } = await import("@/lib/engine/body");
  const { addDays, todayInTz } = await import("@/lib/dates");
  const { loggableUnits, readUnit, storedUnit } = await import("@/lib/engine/body-units");
  const EGG_SODIUM = 70;

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) });
  const today = todayInTz(mem.timezone || ws!.timezone);
  // Every Body table, from the registry that export and deletion read (never a list typed here): B2's tables are in it.
  const { BODY_LABELS, MEMBER_TABLES } = await import("@/lib/member-data");
  const BODY = [...BODY_LABELS].map((l) => MEMBER_TABLES[l] as typeof schema.bodyEntries);
  if (BODY.length < 12) throw new Error(`the Body registry lists every Body table, B2's included: ${BODY.length}`);
  const mine = (t: { workspaceId: Column; userId: Column }) => and(eq(t.workspaceId, mem.workspaceId), eq(t.userId, maya.id));
  const count = async () => {
    let n = 0;
    for (const t of BODY) n += (await db.select().from(t).where(mine(t))).length;
    return n;
  };
  // A walk reads the record and acts on what it finds: start from no Body at all for this client.
  for (const t of BODY) await db.delete(t).where(mine(t));

  const fx = (key: string) => PHASE2_V4.foods.find((f) => f.key === key)!;
  const lift = PHASE2_V4.dayTypes.find((t) => t.key === "lift")!;
  // The foods and meals Danno's day needs, from the fixture: the brief's lunch, a lean steak dinner, and pizza that must not fit.
  const FOODS = ["carne-asada", "egg", "white-cheddar", "lean-steak", "egg-whites-cup", "pizza-v4"];
  const MEALS = ["Office Carne Asada Power Lunch", "Steak + Eggs Dinner", "Pizza V4 3-slice"].map((n) => PHASE2_V4.meals.find((m) => m.name === n)!);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const errors: string[] = [];
  try {
    const client = await (await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true })).newPage();
    const coach = await (await browser.newContext()).newPage();
    for (const p of [client, coach]) p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message.slice(0, 200)}`));
    await login(client, "client@demo.helixos.app");
    await loginCoach(coach);

    // ── Body is off for this client (the default): none of it exists for them, or for their coach. ──
    if ((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) }))!.bodyEnabled) throw new Error("Body starts off for every member");
    // Every (app) page streams behind loading.tsx, so notFound() serves the app's not-found page with the 200 already sent (Next's
    // documented soft 404, as for every missing item in HelixOS). The check is the page itself: the not-found page, nothing of Body.
    const notFoundPage = async (page: Page, path: string) => {
      await page.goto(`${base}${path}`);
      await page.locator('[data-testid="item-gone"]').waitFor({ timeout: 30000 });
      if (await page.locator('[data-testid="body-start"], [data-testid="body-tiles"], [data-testid="body-private-note"], [data-testid="coach-body-private"]').count()) throw new Error(`${path} shows nothing of Body while it's off`);
    };
    for (const path of ["/body", "/body/foods", "/body/settings", "/body/training", "/body/training/routines"]) await notFoundPage(client, path);
    const offExport = await client.request.get(`${base}/api/export?format=json&scope=body`);
    if (offExport.status() !== 404) throw new Error(`the Body export is a 404 while Body is off, got ${offExport.status()}`);
    await client.goto(`${base}/more`);
    // The page streams: wait for the menu itself before reading what's in it.
    await client.locator('main a[href="/today"]').waitFor({ timeout: 30000 });
    if ((await client.locator("main a").count()) < 10) throw new Error("the More page lists the menu to read");
    if (await client.locator('a[href="/body"], a[href="/body/foods"]').count()) throw new Error("no Body entry anywhere in the menu while Body is off");
    if (/HumanOS/.test((await client.locator("main").textContent()) ?? "")) throw new Error("no HumanOS section at all in the menu while Body is off");
    await client.goto(`${base}/today`);
    await client.locator("main h1, main h2").first().waitFor({ timeout: 30000 });
    if (await client.locator('[data-testid="today-body"], [data-testid="today-humanos"]').count()) throw new Error("no Body line or Log a meal on Today while Body is off");
    await notFoundPage(coach, `/coach/${mem.id}/body`);
    await coach.goto(`${base}/coach/${mem.id}`);
    if (await coach.locator('[data-testid="coach-body-link"]').count()) throw new Error("no Body card on the coach's client page while Body is off");
    console.log("✓ Body off (the default): no menu entry, the not-found page on /body, /body/foods and /body/settings, a 404 from the Body export, no Today line, the not-found page and no card on the coach's side");

    // ── The flag goes on by the script, never the UI: a dry run changes nothing, --apply switches it on. ──
    const flag = (...a: string[]) => execFileSync("npx", ["tsx", "scripts/body-flag.ts", "client@demo.helixos.app", ...a], { encoding: "utf8" });
    const dry = flag("on");
    if (!/dry run/.test(dry) || (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) }))!.bodyEnabled) throw new Error(`the dry run changes nothing: ${dry}`);
    const applied = flag("on", "--apply");
    if (!/switched on on 1 membership/.test(applied) || !(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) }))!.bodyEnabled) throw new Error(`--apply switches Body on for this member only: ${applied}`);
    const others = await db.query.memberships.findMany({ where: eq(schema.memberships.bodyEnabled, true) });
    if (others.length !== 1 || others[0].id !== mem.id) throw new Error(`only this member has Body on: ${others.length}`);
    console.log("✓ scripts/body-flag.ts: the dry run changed nothing; --apply switched Body on for this one member");

    // ── Setup: the blank skeleton, private by default. ──
    await client.goto(`${base}/body`);
    if (!/private to you/i.test(await client.locator('[data-testid="body-private-note"]').innerText())) throw new Error("setup says Body is private to the member");
    await client.goto(`${base}/more`);
    await client.locator('main a[href="/today"]').waitFor({ timeout: 30000 });
    if (!(await client.locator('main a[href="/body"]').count()) || !(await client.locator('main a[href="/body/foods"]').count()) || !(await client.locator('main a[href="/body/training"]').count())) throw new Error("the menu has HumanOS's Log, Nutrition and Training once it's on");
    if (!/HumanOS/.test((await client.locator("main").textContent()) ?? "")) throw new Error("the menu has a HumanOS section once Body is on");
    await client.goto(`${base}/body`);
    if (await client.locator('[data-testid^="body-preset-"]').count()) throw new Error("there are no presets to pick: everyone starts blank");
    await noSideScroll(client, "/body setup");
    await press(client, '[data-testid="body-start"]', async () => (await client.locator('[data-testid="body-tiles"]').count()) > 0, "the day's tiles");
    const settings0 = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!;
    const types0 = await db.query.bodyDayTypes.findMany({ where: mine(schema.bodyDayTypes) });
    const blankBands = types0.length === 1 && types0[0].name === "Every day" && [types0[0].calMin, types0[0].calMax, types0[0].pMin, types0[0].pMax, types0[0].fMin, types0[0].fMax, types0[0].cMin, types0[0].cMax].every((v) => v === null);
    if (!blankBands) throw new Error(`one day type, "Every day", with every band empty: ${JSON.stringify(types0)}`);
    if (Object.values(settings0.weekPattern).some((t) => t !== types0[0].id) || Object.keys(settings0.weekPattern).length !== 7) throw new Error("every day of the week is Every day");
    if (settings0.calFloor !== null || settings0.fatFloor !== null || settings0.caps.length || settings0.refeedDayTypeId || settings0.refeedAnchor || settings0.shareWithCoach) throw new Error(`no floors, caps, refeed or sharing: ${JSON.stringify(settings0)}`);
    if (JSON.stringify(settings0.mealSlots) !== JSON.stringify(["Breakfast", "Lunch", "Dinner", "Snacks"])) throw new Error(`the four common slots: ${JSON.stringify(settings0.mealSlots)}`);
    if ((await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).length || (await db.query.bodyMeals.findMany({ where: mine(schema.bodyMeals) })).length) throw new Error("no foods and no meals");
    console.log("✓ setup at phone width: no presets; one \"Every day\" type with empty bands on all seven days, the four slots, no floors, caps, refeed, foods or meals; private");

    // The empty states and the checklist.
    const step = async (key: string) => (await client.locator(`[data-testid="body-step-${key}"]`).getAttribute("data-done")) === "1";
    if (!(await client.locator('[data-testid="body-checklist"]').count())) throw new Error("the fill-in checklist is at the top of /body");
    for (const k of ["targets", "foods", "meals", "logged"]) if (await step(k)) throw new Error(`step ${k} starts undone`);
    if (!(await client.locator('[data-testid="body-no-targets"]').count())) throw new Error("with no bands, the tiles offer Set targets");
    if ((await client.locator('[data-testid^="body-tile-"][data-mark]:not([data-mark=""])').count())) throw new Error("with no bands, no tile carries a mark");
    if (!(await client.locator('[data-testid="body-no-foods"]').innerText()).includes("Add your first food")) throw new Error("with no foods, the log says Add your first food");
    if (await client.locator('[data-testid="body-fits"], [data-testid="body-fits-none"]').count()) throw new Error("no What fits before there are targets");
    await noSideScroll(client, "/body blank");
    // Step 1 (rev 222): "Choose whether AI can help you". Not now answers it and leaves AI off.
    if (await step("ai")) throw new Error("the AI choice starts unanswered");
    await press(client, '[data-testid="body-ai-not-now"]', async () => step("ai"), "the AI choice answered");
    const afterNotNow = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!;
    if (afterNotNow.aiUse || !afterNotNow.aiAskedAt) throw new Error("Not now answers the question and leaves AI off");
    if (!/Not now/.test(await client.locator('[data-testid="body-ai-answer"]').innerText())) throw new Error("the step says what was chosen");
    await client.goto(`${base}/today`);
    await client.locator("main h1, main h2").first().waitFor({ timeout: 30000 });
    if (await client.locator('[data-testid="today-body"]').count()) throw new Error("the Today line waits for targets");
    if ((await client.locator('[data-testid="today-log-meal"]').getAttribute("href")) !== "/body#log") throw new Error("once set up, Today has Log a meal, to /body#log");
    console.log("✓ the blank page: step 1 asks about AI (Not now leaves it off); the checklist with every step open, totals only with Set targets, Add your first food, no What fits, no Today line");

    // ── ① Targets, through the day type form (the fixture's lift-day bands), and the floors through the settings form. ──
    await client.goto(`${base}/body/settings`);
    for (const [name, value] of [["calMin", lift.cal[0]], ["calMax", lift.cal[1]], ["pMin", lift.p[0]], ["pMax", lift.p[1]], ["fMin", lift.f[0]], ["fMax", lift.f[1]], ["cMin", lift.c[0]], ["cMax", lift.c[1]]] as const) {
      await fillExact(client, `[data-testid="body-day-types"] li form input[name="${name}"]`, String(value));
    }
    await press(client, '[data-testid="body-day-types"] li form button[type="submit"]', async () => {
      const t = await db.query.bodyDayTypes.findFirst({ where: eq(schema.bodyDayTypes.id, types0[0].id) });
      return t?.calMin === lift.cal[0] && t?.cMax === lift.c[1];
    }, "the bands saved");
    await fillExact(client, '[data-testid="body-settings-form"] input[name="calFloor"]', String(PHASE2_V4.floors.cal));
    await fillExact(client, '[data-testid="body-settings-form"] input[name="fatFloor"]', String(PHASE2_V4.floors.f));
    await press(client, '[data-testid="body-settings-save"]', async () => (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))?.fatFloor === PHASE2_V4.floors.f, "the floors saved");
    await noSideScroll(client, "/body/settings");
    console.log(`✓ ① targets entered through the app: ${lift.cal.join("–")} cal, ${lift.p.join("–")} P, ${lift.f.join("–")} F, ${lift.c.join("–")} C, floors ${PHASE2_V4.floors.cal} cal / ${PHASE2_V4.floors.f} g fat`);

    // ── ③ Foods and ④ meals, through the forms. ──
    await client.goto(`${base}/body/foods`);
    const foodRows = () => client.locator('[data-testid="body-food-table"] tbody tr').count();
    for (const key of FOODS) {
      const f = fx(key);
      const form = client.locator('[data-testid="body-new-food"]');
      await openDisclosure(client, "New food", '[data-testid="body-new-food"]');
      for (const [name, value] of [["name", f.name], ["cal", f.cal], ["p", f.p], ["f", f.f], ["c", f.c]] as const) await fillExact(client, `[data-testid="body-new-food"] input[name="${name}"]`, String(value));
      // The "per" unit is a dropdown (rev 229): a listed unit is picked; anything else (an egg) is Other with its words.
      if (readUnit(f.unit).unit) await form.locator('select[name="unitChoice"]').selectOption(readUnit(f.unit).unit!);
      else {
        await form.locator('select[name="unitChoice"]').selectOption("other");
        await fillExact(client, '[data-testid="body-new-food"] input[name="unitOther"]', f.unit);
      }
      if (key === "egg") await fillExact(client, '[data-testid="body-new-food"] input[name="sodium"]', String(EGG_SODIUM));
      if (key === "white-cheddar") await fillExact(client, '[data-testid="body-new-food"] input[name="capTag"]', "cheese");
      const before = await foodRows();
      await press(client, '[data-testid="body-new-food"] button[type="submit"]', async () => (await foodRows()) === before + 1, `${f.name} added`);
    }
    const foods = await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) });
    if ((await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, fx("white-cheddar").name)) }))?.capTag !== "cheese") throw new Error("the tag field saves a cap tag");
    if ((await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, fx("egg").name)) }))?.sodium !== EGG_SODIUM) throw new Error("sodium saves on the food");
    const idOf = (key: string) => foods.find((f) => f.name === fx(key).name)!.id;
    for (const key of FOODS) {
      const f = foods.find((x) => x.name === fx(key).name);
      if (!f || f.cal !== fx(key).cal || f.p !== fx(key).p || f.f !== fx(key).f || f.c !== fx(key).c || f.unit !== storedUnit(fx(key).unit)) throw new Error(`${fx(key).name} saved as typed: ${JSON.stringify(f)}`);
    }
    const mealRows = () => client.locator('[data-testid="body-meal-list"] > li').count();
    for (const meal of MEALS) {
      const form = client.locator('[data-testid="body-new-meal"]');
      await openDisclosure(client, "New meal", '[data-testid="body-new-meal"]');
      await fillExact(client, '[data-testid="body-new-meal"] input[name="name"]', meal.name);
      if (meal.slot) await form.locator('select[name="slot"]').selectOption(meal.slot);
      for (const [i, item] of meal.items.entries()) {
        await form.locator(`select[name="item_${i}_food"]`).selectOption(idOf(item.food));
        await fillExact(client, `[data-testid="body-new-meal"] input[name="item_${i}_qty"]`, String(item.qty));
      }
      const before = await mealRows().catch(() => 0);
      await press(client, '[data-testid="body-new-meal"] button[type="submit"]', async () => (await mealRows().catch(() => 0)) === before + 1, `${meal.name} saved`);
    }
    await noSideScroll(client, "/body/foods");
    console.log(`✓ ③ ${FOODS.length} foods and ④ ${MEALS.length} meals entered through the forms, saved exactly as typed`);

    // ── ⑤ The carne asada lunch in one tap; the checklist goes; what fits offers the steak dinner, no pizza. ──
    await client.goto(`${base}/body`);
    for (const k of ["targets", "foods", "meals"]) if (!(await step(k))) throw new Error(`step ${k} is ticked`);
    if (await step("logged")) throw new Error("nothing logged yet");
    const lunch = MEALS[0];
    const lunchRow = client.locator(`[data-testid="body-meal"][data-name="${lunch.name}"]`);
    await lunchRow.locator('select[name="slot"]').selectOption("Lunch");
    await press(client, `[data-testid="body-meal"][data-name="${lunch.name}"] [data-testid="body-log-meal"]`, async () => (await entryCount(client)) === 1, "the lunch logged");
    if (await client.locator('[data-testid="body-checklist"]').count()) throw new Error("the checklist hides once targets, a food and a first meal are in");
    const fits = await client.locator('[data-testid="body-fit"]').allInnerTexts();
    if (!fits.length || !fits.some((f) => f.includes("Steak + Eggs Dinner"))) throw new Error(`after the lunch, what fits offers the steak dinner: ${JSON.stringify(fits)}`);
    if (fits.some((f) => f.includes("Pizza"))) throw new Error("three slices of pizza don't fit after that lunch");
    console.log(`✓ ⑤ one tap logs the lunch and the checklist goes; what fits offers ${fits.length} meal${fits.length === 1 ? "" : "s"}, the steak dinner among them, no pizza`);

    // ── Dinner as foods × quantity: 10 oz lean steak and a cup of egg whites. ──
    // The steak goes in grams: 10 oz is 283.495 g, converted back into the food's own oz so its macros apply.
    for (const [key, qty, unit] of [["lean-steak", "283.495", "g"], ["egg-whites-cup", "1", "cup"]] as const) {
      const form = client.locator('[data-testid="body-log-food-form"]');
      await form.locator('select[name="foodId"]').selectOption(idOf(key));
      const offered = await form.locator('select[name="unit"] option').allTextContents();
      if (JSON.stringify(offered) !== JSON.stringify(loggableUnits(fx(key).unit))) throw new Error(`${key} offers its group's units: ${JSON.stringify(offered)}`);
      await form.locator('select[name="unit"]').selectOption(unit);
      await fillExact(client, '[data-testid="body-log-food-form"] input[name="qty"]', qty);
      await form.locator('select[name="slot"]').selectOption("Dinner");
      const before = await entryCount(client);
      await press(client, '[data-testid="body-log-food"]', async () => (await entryCount(client)) === before + 1, `${key} logged`);
    }
    // A count or Other unit (an egg) doesn't convert: only its own unit, with the reason.
    await client.locator('[data-testid="body-log-food-form"] select[name="foodId"]').selectOption(idOf("egg"));
    if (JSON.stringify(await client.locator('[data-testid="body-log-food-form"] select[name="unit"] option').allTextContents()) !== JSON.stringify(["egg"]) || !(await client.locator('[data-testid="body-log-unit-note"]').count())) throw new Error("an egg is logged in eggs only, and the form says why");
    const entries = await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.date, today)) });
    const steak = entries.find((e) => e.name === fx("lean-steak").name);
    if (steak?.items[0].qty !== 10 || steak.items[0].unit !== "oz") throw new Error(`283.495 g of steak is logged as 10 oz: ${JSON.stringify(steak?.items[0])}`);
    const sodiumShown = await client.locator('[data-testid="body-sodium"]').innerText();
    if (!sodiumShown.includes(`${2 * EGG_SODIUM} mg`)) throw new Error(`the lunch's two eggs show ${2 * EGG_SODIUM} mg of sodium: "${sodiumShown}"`);
    if (entries.length !== 3) throw new Error(`three entries today, got ${entries.length}`);
    const settings = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!;
    const totals = sumMacros(entries.map((e) => sumMacros(e.items.map((i) => portionMacros(i)))));
    const bands = { cal: { min: lift.cal[0], max: lift.cal[1] }, p: { min: lift.p[0], max: lift.p[1] }, f: { min: lift.f[0], max: lift.f[1] }, c: { min: lift.c[0], max: lift.c[1] } };
    const expectMarks = dayMarks(totals, bands, { floors: { cal: settings.calFloor, f: settings.fatFloor }, overOk: settings.overOk, final: false });
    for (const m of MACROS) {
      const tile = client.locator(`[data-testid="body-tile-${m}"]`);
      const shown = await tile.innerText();
      if (!shown.includes(fmtMacro(m, totals[m]))) throw new Error(`the ${m} tile shows ${fmtMacro(m, totals[m])}: "${shown}"`);
      if ((await tile.getAttribute("data-mark")) !== expectMarks[m]) throw new Error(`the ${m} mark is the engine's ${expectMarks[m]}, got ${await tile.getAttribute("data-mark")}`);
    }
    if (MACROS.some((m) => expectMarks[m] !== "in")) throw new Error(`the brief's day, ${JSON.stringify(totals)}, is ✅ on every macro: ${JSON.stringify(expectMarks)}`);
    await noSideScroll(client, "/body with a day logged");
    // HumanOS's page (rev 238): the eyebrow, a gear to settings, and a lead line that says what's left in words.
    if (!(await client.locator('[data-testid="humanos-eyebrow"]').count()) || (await client.locator('[data-testid="humanos-gear"]').getAttribute("href")) !== "/body/settings") throw new Error("the Log page has the HumanOS eyebrow and a gear to settings");
    const lead = (await client.locator('[data-testid="body-lead"] [data-testid="body-left"]').textContent()) ?? "";
    if (!/\d g protein (to go|left|over)/.test(lead) || !/cal (to go|left|over)/.test(lead)) throw new Error(`the Log page leads with what's left in words: "${lead}"`);
    console.log(`✓ lunch + a lean steak dinner = ${fmtMacro("cal", totals.cal)} / ${totals.p} P / ${totals.f} F / ${totals.c} C: every tile ✅ as the engine says`);

    await client.goto(`${base}/today`);
    const line = (await client.locator('[data-testid="today-body"]').textContent()) ?? "";
    if (!line.includes("Every day") || !line.includes(`${fmtMacro("cal", totals.cal)} of`)) throw new Error(`Today's Body line names the day type and the calories: "${line}"`);
    await noSideScroll(client, "/today");
    console.log(`✓ Today carries one Body line once targets exist: "${line.replace(/\s+/g, " ").trim()}"`);

    // ── B2 workouts (rev 182): exercises and a routine through the forms, yesterday's sets, then today's routine with last time,
    // the PR and a new PR; the history chart; a day marked Off and undone. Everything typed as a member would. ──
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-empty"]').waitFor({ timeout: 30000 });
    await noSideScroll(client, "/body/training, nothing yet");
    await client.goto(`${base}/body/training/routines`);
    const EXERCISES = [{ name: "Bench press", kind: "weight" }, { name: "Pull-up", kind: "bodyweight" }] as const;
    for (const e of EXERCISES) {
      await openDisclosure(client, "New exercise", '[data-testid="training-new-exercise"]');
      await fillExact(client, '[data-testid="training-new-exercise"] input[name="name"]', e.name);
      await client.locator('[data-testid="training-new-exercise"] select[name="kind"]').selectOption(e.kind);
      await press(client, '[data-testid="training-save-exercise"]', async () => (await client.locator(`[data-testid="training-exercise-row"][data-name="${e.name}"]`).count()) > 0, e.name);
    }
    const exRows = await db.query.bodyExercises.findMany({ where: mine(schema.bodyExercises) });
    if (exRows.length !== EXERCISES.length || EXERCISES.some((e) => exRows.find((r) => r.name === e.name)?.kind !== e.kind)) throw new Error(`the exercises saved as typed: ${exRows.map((r) => `${r.name}/${r.kind}`).join(", ")}`);
    const exId = (name: string) => exRows.find((r) => r.name === name)!.id;
    const ROUTINE = { name: "Push A", lines: [{ ex: "Bench press", sets: 3, reps: "5" }, { ex: "Pull-up", sets: 3, reps: "8–10" }] };
    const rForm = '[data-testid="training-new-routine"]';
    await openDisclosure(client, "New routine", rForm);
    await fillExact(client, `${rForm} input[name="name"]`, ROUTINE.name);
    await client.locator(`${rForm} select[name="dayTypeId"]`).selectOption(types0[0].id);
    for (const [i, l] of ROUTINE.lines.entries()) {
      await client.locator(`${rForm} select[name="item_${i}_exercise"]`).selectOption(exId(l.ex));
      await fillExact(client, `${rForm} input[name="item_${i}_sets"]`, String(l.sets));
      await fillExact(client, `${rForm} input[name="item_${i}_reps"]`, l.reps);
    }
    await press(client, `${rForm} button[type="submit"]`, async () => (await client.locator(`[data-testid="training-routine-row"][data-name="${ROUTINE.name}"]`).count()) > 0, ROUTINE.name);
    const routine = (await db.query.bodyRoutines.findFirst({ where: mine(schema.bodyRoutines) }))!;
    const wantItems = ROUTINE.lines.map((l) => ({ exerciseId: exId(l.ex), sets: l.sets, reps: l.reps }));
    if (routine.dayTypeId !== types0[0].id || JSON.stringify(routine.items) !== JSON.stringify(wantItems)) throw new Error(`the routine saved as typed, on ${types0[0].name} days: ${JSON.stringify(routine)}`);
    await noSideScroll(client, "/body/training/routines");

    const card = (name: string) => `[data-testid="training-exercise"][data-name="${name}"]`;
    const setsIn = (name: string) => client.locator(`${card(name)} [data-testid="training-set"]`);
    const logSet = async (name: string, weight: string, reps: string) => {
      const before = await setsIn(name).count();
      await fillExact(client, `${card(name)} [data-testid="training-log-form"] input[name="weight"]`, weight);
      await fillExact(client, `${card(name)} [data-testid="training-log-form"] input[name="reps"]`, reps);
      await press(client, `${card(name)} [data-testid="training-log-set"]`, async () => (await setsIn(name).count()) === before + 1, `${name}: set ${before + 1}`);
    };
    // Yesterday: the routine offered for the day type, started in one tap; two sets of bench, the first ever, so no PR yet.
    const yesterday = addDays(today, -1);
    await client.goto(`${base}/body/training?date=${yesterday}`);
    await client.locator('[data-testid="training-start-suggested"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="training-start-suggested"]', async () => (await client.locator('[data-testid="training-exercise"]').count()) === ROUTINE.lines.length, `${ROUTINE.name}'s exercises`);
    await logSet("Bench press", "185", "5");
    await logSet("Bench press", "185", "5");
    if ((await setsIn("Bench press").evaluateAll((els) => els.map((e) => e.getAttribute("data-pr")))).some((f) => f !== "0")) throw new Error("a first-ever set and its equal aren't PRs");
    // Today: last time and the PR beside the exercise, the form opening on last time's set; 190 × 5 is a new PR.
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-start-suggested"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="training-start-suggested"]', async () => (await client.locator('[data-testid="training-exercise"]').count()) === ROUTINE.lines.length, "today's routine");
    const benchLast = (await client.locator(`${card("Bench press")} [data-testid="training-last"]`).textContent()) ?? "";
    const benchPr = (await client.locator(`${card("Bench press")} [data-testid="training-pr"]`).textContent()) ?? "";
    if (!benchLast.includes("185 × 5 · 185 × 5") || benchPr !== "PR 185 × 5") throw new Error(`last time and the PR beside the bench: "${benchLast}", "${benchPr}"`);
    if (!((await client.locator(`${card("Bench press")} [data-testid="training-plan"]`).textContent()) ?? "").includes("0 of 3 sets · 5 reps")) throw new Error("the routine's plan shows, nothing logged yet");
    const openW = await client.locator(`${card("Bench press")} [data-testid="training-log-form"] input[name="weight"]`).inputValue();
    const openR = await client.locator(`${card("Bench press")} [data-testid="training-log-form"] input[name="reps"]`).inputValue();
    if (openW !== "185" || openR !== "5") throw new Error(`the set form opens on last time's set: ${openW} × ${openR}`);
    await logSet("Bench press", "190", "5");
    if ((await setsIn("Bench press").first().getAttribute("data-pr")) !== "1") throw new Error("190 × 5 beats 185 × 5: a PR");
    // Bodyweight: reps alone; then a set logged by mistake and deleted.
    await logSet("Pull-up", "", "10");
    if (!((await setsIn("Pull-up").first().textContent()) ?? "").includes("10 reps")) throw new Error("a bodyweight set reads as its reps");
    await logSet("Pull-up", "", "8");
    await press(client, `${card("Pull-up")} [data-testid="training-delete-set"] >> nth=1`, async () => (await setsIn("Pull-up").count()) === 1, "the mistaken set gone");
    const sets = await db.query.bodySets.findMany({ where: mine(schema.bodySets) });
    const want = [`${yesterday} Bench press 185x5 lb`, `${yesterday} Bench press 185x5 lb`, `${today} Bench press 190x5 lb`, `${today} Pull-up nullx10 lb`].sort();
    // (a fifth set, Pull-up 7, is logged below, after Finish)
    const got = sets.map((x) => `${x.date} ${exRows.find((r) => r.id === x.exerciseId)!.name} ${x.weight}x${x.reps} ${x.unit}`).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`the sets saved as logged: ${got.join("; ")}`);
    await noSideScroll(client, "/body/training with sets");
    // Phase 3: sets against the plan, Finish with a note, a set after finishing reopens, and the week's tally with the heatmap.
    const header = async () => (await client.locator('[data-testid="training-session"]').textContent()) ?? "";
    if (!(await header()).includes("2 of 6 planned sets")) throw new Error(`the header counts sets against the routine's plan: "${await header()}"`);
    if (!((await client.locator(`${card("Bench press")} [data-testid="training-plan"]`).textContent()) ?? "").includes("1 of 3 sets")) throw new Error("each exercise counts its sets against the plan");
    if ((await setsIn("Bench press").first().getAttribute("data-plan")) !== "in" || (await setsIn("Pull-up").first().getAttribute("data-plan")) !== "in") throw new Error("190 × 5 against 5, and 10 against 8–10, are in plan");
    await fillExact(client, '[data-testid="training-finish-form"] input[name="note"]', "Felt strong");
    await press(client, '[data-testid="training-finish"]', async () => (await client.locator('[data-testid="training-finished"]').count()) > 0, "the session finished");
    const finished = await db.query.bodySessions.findFirst({ where: and(mine(schema.bodySessions), eq(schema.bodySessions.date, today)) });
    if (!finished?.completedAt || finished.note !== "Felt strong" || !((await client.locator('[data-testid="training-finished"]').textContent()) ?? "").includes("Felt strong")) throw new Error("Finish stamps the session with its note");
    await logSet("Pull-up", "", "7");
    if ((await db.query.bodySessions.findFirst({ where: and(mine(schema.bodySessions), eq(schema.bodySessions.date, today)) }))?.completedAt) throw new Error("a set after finishing reopens the session");
    if ((await client.locator('[data-testid="training-finished"]').count()) || (await setsIn("Pull-up").nth(1).getAttribute("data-plan")) !== "under") throw new Error("reopened, and 7 against 8–10 is under plan");
    const { trainingWeeks } = await import("@/lib/queries/body");
    const tw = (await trainingWeeks(mem.workspaceId, maya.id, today))!;
    const weekText = (await client.locator('[data-testid="training-week"]').textContent()) ?? "";
    if (tw.tally.planned == null || !weekText.includes(`${tw.tally.done} of ${tw.tally.planned} session`)) throw new Error(`the week's tally is the engine's (${tw.tally.done} of ${tw.tally.planned}): "${weekText}"`);
    if ((await client.locator('[data-testid="training-heat"] .rounded-sm').count()) !== 84) throw new Error("the heatmap draws 12 weeks of 7 days");
    await noSideScroll(client, "/body/training finished");
    // The history: a point per session, and the PR.
    await client.goto(`${base}/body/training/${exId("Bench press")}`);
    await client.locator('[data-testid="trend-line"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="trend-point"]').count()) !== 2 || !((await client.locator('[data-testid="history-pr"]').textContent()) ?? "").includes("PR 190 × 5")) throw new Error("the history charts both sessions and names the PR");
    await noSideScroll(client, "the bench history");
    // Off: two days ago marked Off, then undone; the row goes with it (no hand-set type on that day).
    const twoAgo = addDays(today, -2);
    await client.goto(`${base}/body/training?date=${twoAgo}`);
    await client.locator('[data-testid="training-mark-off"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="training-mark-off"]', async () => (await client.locator('[data-testid="training-off"]').count()) > 0, "the day Off");
    const offRow = await db.query.bodyDays.findFirst({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.date, twoAgo)) });
    if (!offRow?.off) throw new Error("Off is saved on the day");
    await press(client, '[data-testid="training-undo-off"]', async () => (await client.locator('[data-testid="training-mark-off"]').count()) > 0, "the day back");
    if (await db.query.bodyDays.findFirst({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.date, twoAgo)) })) throw new Error("undoing Off leaves no row behind");
    console.log(`✓ B2 workouts: ${EXERCISES.length} exercises and ${ROUTINE.name} through the forms; yesterday's 185 × 5 ×2 (no PR on a first), today's routine offered for the day type with last time, the PR and the form on 185 × 5; 190 × 5 flagged a PR; bodyweight as reps; a set deleted; the history charts 2 sessions; Off marked and undone`);
    // ── Body composition (rev 237 phase 2): weigh-ins typed and imported from both RENPHO layouts (synthetic fixtures), the day's
    // lowest reading kept whole as its figure, a re-import adding nothing, the trend cards with the engine's own 7-day average, a
    // goal line, a reading deleted, and the Log page's line. ──
    const { parseScaleCsv, dayFigure, fmtMetric: fmtM } = await import("@/lib/engine/body-scale");
    const { dayComposition, weighIns } = await import("@/lib/queries/body");
    const { readFileSync } = await import("node:fs");
    await client.goto(`${base}/body`);
    await client.locator('[data-testid="body-weight-line"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="body-weight-line"]').getAttribute("data-has")) !== "0") throw new Error("Log says there's no weigh-in yet");
    await client.locator('[data-testid="body-weight-line"]').click();
    await client.waitForURL(/\/body\/weight/);
    await client.locator('[data-testid="weigh-empty"]').waitFor({ timeout: 30000 });
    await noSideScroll(client, "/body/weight, empty");
    const weigh = async (weight: string, bf: string, time: string) => {
      await client.goto(`${base}/body/weight`);
      await client.locator('[data-testid="weigh-form"]').waitFor({ timeout: 30000 });
      await fillExact(client, '[data-testid="weigh-form"] input[name="weight"]', weight);
      await fillExact(client, '[data-testid="weigh-form"] input[name="bf"]', bf);
      const timeField = client.locator('[data-testid="weigh-form"] input[name="time"]');
      if (!(await timeField.isVisible())) await client.locator('[data-testid="weigh-form"] summary').click();
      await fillExact(client, '[data-testid="weigh-form"] input[name="time"]', time);
      await Promise.all([client.waitForURL(/logged=1/), client.locator('[data-testid="weigh-save"]').click()]);
      await client.locator('[data-testid="weigh-latest"]').waitFor({ timeout: 30000 });
    };
    // Two readings today, the heavier one first: the day's figure is the lighter one, with its own body fat.
    await weigh("150.4", "21.0", "21:00");
    await weigh("149.6", "20.6", "07:10");
    const latestText = (await client.locator('[data-testid="weigh-latest"]').textContent()) ?? "";
    if (!latestText.includes("149.6 lb") || !latestText.includes("20.6%")) throw new Error(`the day's figure is its lowest reading, whole: "${latestText}"`);
    const todayRows = await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.date, today)) });
    if (new Set(todayRows.map((x) => x.readingId)).size !== 2 || todayRows.filter((x) => x.key === "weight").length !== 2) throw new Error(`both readings are stored, whole: ${todayRows.length} rows`);
    if (todayRows.some((x) => x.key === "ffm")) throw new Error("fat-free mass is derived on read, never stored when it wasn't typed");
    // The older export: every reading it holds, the bad row skipped and said so; a second import adds nothing.
    const importFile = async (name: string) => {
      const text = readFileSync(`scripts/fixtures/${name}`, "utf8");
      const parsed = parseScaleCsv(text);
      await client.goto(`${base}/body/weight`);
      // A file set before React has hydrated the input fires no change handler (a cold compile): set it again until the preview shows.
      const preview = client.locator('[data-testid="scale-preview"]');
      for (let i = 0; i < 5 && !(await preview.count()); i++) {
        await client.locator('[data-testid="scale-file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
        await preview.waitFor({ timeout: 4000 }).catch(() => undefined);
      }
      await preview.waitFor({ timeout: 10000 });
      if ((await preview.getAttribute("data-count")) !== String(parsed.readings.length)) throw new Error(`${name}: the preview counts the parser's readings`);
      if ((await client.locator('[data-testid="scale-skipped"]').count()) !== (parsed.skipped.length ? 1 : 0)) throw new Error(`${name}: the preview names skipped rows only when there are any`);
      await Promise.all([client.waitForURL(/imported=/), client.locator('[data-testid="scale-import-go"]').click()]);
      const done = client.locator('[data-testid="scale-imported"]');
      await done.waitFor({ timeout: 30000 });
      return { parsed, imported: Number(await done.getAttribute("data-imported")), already: Number(await done.getAttribute("data-already")) };
    };
    const renphoReadings = async () => new Set((await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.source, "renpho")) })).map((x) => x.readingId)).size;
    const older = await importFile("renpho-older.csv");
    if (older.imported !== older.parsed.readings.length || older.already !== 0 || !older.parsed.skipped.length) throw new Error(`the older export imports every reading (${older.parsed.readings.length}), with its bad row skipped: got ${older.imported}`);
    if ((await renphoReadings()) !== older.parsed.readings.length) throw new Error("each imported reading is one readingId");
    const again = await importFile("renpho-older.csv");
    if (again.imported !== 0 || again.already !== older.parsed.readings.length) throw new Error(`a re-import adds nothing: imported ${again.imported}, already ${again.already}`);
    const newer = await importFile("renpho-newer.csv");
    if (newer.imported !== newer.parsed.readings.length || newer.parsed.skipped.length) throw new Error(`the newer export imports every reading (${newer.parsed.readings.length}): got ${newer.imported}`);
    // 12 Sep has two readings in the newer file: the day's figure is the engine's lowest, whole.
    const twelfth = dayFigure(newer.parsed.readings.filter((x) => x.date === "2026-09-12"))!;
    const stored12 = await dayComposition(mem.workspaceId, maya.id, "2026-09-12");
    if (!stored12 || stored12.values.weight !== twelfth.values.weight || stored12.values.bf !== twelfth.values.bf || stored12.time !== twelfth.time) throw new Error(`12 Sep's figure is the lowest reading, whole: ${JSON.stringify(stored12?.values)} vs ${JSON.stringify(twelfth.values)}`);
    // Trends over everything: a card per primary metric with data, the weight card's numbers the engine's, the average line, no goal yet.
    await client.goto(`${base}/body/weight?range=all`);
    await client.locator('[data-testid="trend-cards"]').waitFor({ timeout: 30000 });
    const view = (await weighIns(mem.workspaceId, maya.id, today, null))!;
    const withData = view.cards.filter((c) => c.points.length).length;
    if (withData !== 8 || (await client.locator('[data-testid="trend-cards"]').getAttribute("data-count")) !== "8") throw new Error(`a trend card per primary metric with data: ${withData} in the record`);
    const weightStats = (await client.locator('[data-testid="trend-weight-stats"]').textContent()) ?? "";
    const wc = view.cards.find((c) => c.metric.key === "weight")!;
    if (wc.stats.avg7 == null || !weightStats.includes(fmtM("weight", wc.stats.avg7, "lb"))) throw new Error(`the weight card shows the engine's 7-day average ${wc.stats.avg7}: "${weightStats}"`);
    if (!(await client.locator('#trend-weight [data-testid="trend-avg"]').count()) || (await client.locator('#trend-weight [data-testid="trend-goal"]').count())) throw new Error("the average line is drawn and no goal line before a goal");
    await noSideScroll(client, "/body/weight with trends");
    // A goal: the line appears and the card names it.
    if (!(await client.locator('[data-testid="goal-weight"] input[name="target"]').isVisible())) await client.locator("#trend-weight summary").click();
    await fillExact(client, '[data-testid="goal-weight"] input[name="target"]', "145");
    await fillExact(client, '[data-testid="goal-weight"] input[name="by"]', "2026-12-01");
    await press(client, '[data-testid="goal-weight"] button[type="submit"]', async () => (await client.locator('#trend-weight [data-testid="trend-goal"]').count()) > 0, "the goal line");
    const goal = await db.query.bodyGoals.findFirst({ where: mine(schema.bodyGoals) });
    if (goal?.target !== 145 || goal.by !== "2026-12-01" || !((await client.locator('[data-testid="trend-weight-goal"]').textContent()) ?? "").includes("145 lb")) throw new Error("the goal is saved and shown");
    // Delete today's lighter reading: the figure becomes the other one.
    const lighter = client.locator(`[data-testid="weigh-reading"][data-date="${today}"]`, { hasText: "149.6" });
    if ((await lighter.count()) !== 1) throw new Error("today's lighter reading is listed once");
    await lighter.locator('[data-testid="weigh-delete"]').click();
    await client.locator('dialog[open] [data-testid="confirm-delete-yes"]').click();
    for (let i = 0; i < 100 && !((await client.locator('[data-testid="weigh-latest"]').textContent()) ?? "").includes("150.4 lb"); i++) await client.waitForTimeout(100);
    if (!((await client.locator('[data-testid="weigh-latest"]').textContent()) ?? "").includes("150.4 lb")) throw new Error("with the lighter reading gone, the day's figure is the other one");
    await client.goto(`${base}/body`);
    const weightLine = (await client.locator('[data-testid="body-weight-line"]').textContent()) ?? "";
    if (!weightLine.includes("150.4 lb") || !weightLine.includes("21%")) throw new Error(`Log carries the latest weigh-in: "${weightLine}"`);
    console.log(`✓ weigh-ins: two typed today (the lighter kept whole as the day's figure), the older export imported (${older.imported} readings, its bad row skipped) then re-imported for nothing new, the newer export (${newer.imported}) with 12 Sep's lowest as its figure; 8 trend cards with the engine's 7-day average; a goal line; a reading deleted; the Log line`);
    // ── Pantry (phase 5): items on the shelf, use soon on Pantry and Log, a par level and the gap to buy, a raw → cooked weighing
    // and the yield learned, 8 oz logged raw against a cooked food (converted, off the shelf), and an item used up by hand. ──
    await client.goto(`${base}/body/pantry`);
    await client.locator('[data-testid="pantry-empty"]').waitFor({ timeout: 30000 });
    const shelfRows = () => client.locator('[data-testid="pantry-item"]').count();
    const addToShelf = async (foodId: string, qty: string, state: "raw" | "cooked", useBy: string) => {
      const before = await shelfRows();
      const form = client.locator('[data-testid="pantry-add"]');
      if (!(await form.isVisible())) await client.locator("summary", { hasText: "Add to the shelf" }).click();
      await form.locator('select[name="foodId"]').selectOption(foodId);
      await fillExact(client, '[data-testid="pantry-qty"]', qty);
      await form.locator('select[name="state"]').selectOption(state);
      await fillExact(client, '[data-testid="pantry-use-by"]', useBy);
      await press(client, '[data-testid="pantry-save"]', async () => (await shelfRows()) === before + 1, "the item on the shelf");
    };
    await addToShelf(idOf("lean-steak"), "16", "raw", addDays(today, 2));
    await addToShelf(idOf("egg"), "12", "raw", addDays(today, 10));
    if (!((await client.locator('[data-testid="pantry-soon"]').textContent()) ?? "").includes(fx("lean-steak").name)) throw new Error("the steak, use by in two days, is to use soon");
    const steakPar = `[data-testid="pantry-par"][data-food="${fx("lean-steak").name}"]`;
    if (!(await client.locator(`${steakPar} input[name="par"]`).isVisible())) await client.locator("summary", { hasText: "Par levels" }).click();
    await fillExact(client, `${steakPar} input[name="par"]`, "24");
    await press(client, `${steakPar} button[type="submit"]`, async () => (await client.locator('[data-testid="pantry-gap"]').count()) > 0, "the gap to buy");
    const gap = (await client.locator('[data-testid="pantry-gap"]').first().textContent()) ?? "";
    if (!gap.includes("8 oz") || !gap.includes("16 of 24")) throw new Error(`below par: 8 oz to buy with 16 of 24 on hand: "${gap}"`);
    const weighForm = client.locator('[data-testid="pantry-weigh"]');
    if (!(await weighForm.isVisible())) await client.locator("summary", { hasText: "Add a weighing" }).click();
    await weighForm.locator('select[name="foodId"]').selectOption(idOf("lean-steak"));
    await fillExact(client, '[data-testid="pantry-weigh-raw"]', "16");
    await fillExact(client, '[data-testid="pantry-weigh-cooked"]', "9.8");
    const steakYield = `[data-testid="pantry-yield"][data-food="${fx("lean-steak").name}"]`;
    await press(client, '[data-testid="pantry-weigh-save"]', async () => (await client.locator(steakYield).getAttribute("data-factor")) === "0.61", "the 61% yield learned");
    // On yesterday's Log (today's totals stay as checked): 8 oz of steak weighed raw is 4.88 oz cooked, and the shelf loses 8 oz raw.
    await client.goto(`${base}/body?date=${yesterday}`);
    await client.locator('[data-testid="body-log-food-form"]').waitFor({ timeout: 30000 });
    if (!((await client.locator('[data-testid="body-use-soon"]').textContent()) ?? "").includes(fx("lean-steak").name)) throw new Error("Log says what to use soon");
    const yBefore = await entryCount(client);
    await client.locator('[data-testid="body-log-food-form"] select[name="foodId"]').selectOption(idOf("lean-steak"));
    await fillExact(client, '[data-testid="body-log-food-form"] input[name="qty"]', "8");
    await client.locator('[data-testid="body-log-weighed"]').selectOption("raw");
    await press(client, '[data-testid="body-log-food"]', async () => (await entryCount(client)) === yBefore + 1, "the raw steak logged");
    const rawEntry = (await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.date, yesterday)) })).find((e) => e.items[0]?.weighed === "raw");
    if (!rawEntry || Math.abs(rawEntry.items[0].qty - 4.88) > 0.01 || rawEntry.items[0].check) throw new Error(`8 oz raw at 61% logs as 4.88 oz cooked, unflagged: ${JSON.stringify(rawEntry?.items)}`);
    const steakShelf = await db.query.bodyPantry.findFirst({ where: and(mine(schema.bodyPantry), eq(schema.bodyPantry.foodId, idOf("lean-steak"))) });
    if (!steakShelf || Math.abs(steakShelf.qty - 8) > 0.01) throw new Error(`the shelf loses the 8 oz raw: ${steakShelf?.qty}`);
    await client.goto(`${base}/body/pantry`);
    const eggRow = `[data-testid="pantry-item"][data-food="${fx("egg").name}"]`;
    await client.locator(eggRow).waitFor({ timeout: 30000 });
    await fillExact(client, `${eggRow} [data-testid="pantry-use-qty"]`, "12");
    await press(client, `${eggRow} [data-testid="pantry-use"]`, async () => (await client.locator(eggRow).count()) === 0, "the eggs gone");
    await noSideScroll(client, "/body/pantry");
    console.log("✓ pantry: 16 oz raw steak and 12 eggs on the shelf; the steak (use by in two days) to use soon on Pantry and Log; par 24 oz gives 8 oz to buy; 16 → 9.8 oz weighed learns a 61% yield; 8 oz logged raw lands as 4.88 oz cooked and the shelf keeps 8 oz raw; the eggs used up by hand");
    // ── The weekly rollup (phase 6): the page's tiles against the query's own numbers, last week reachable, next week shut. ──
    const { bodyWeek } = await import("@/lib/queries/body");
    const { startOfWeek } = await import("@/lib/dates");
    const wk = (await bodyWeek(mem.workspaceId, maya.id, startOfWeek(today), today))!;
    await client.goto(`${base}/body`);
    await client.locator('[data-testid="body-week-link"]').click();
    await client.waitForURL(/\/body\/week/);
    await client.locator('[data-testid="week-nutrition"]').waitFor({ timeout: 30000 });
    const nut = client.locator('[data-testid="week-nutrition"]');
    if ((await nut.getAttribute("data-logged")) !== String(wk.nutrition.daysLogged) || (await nut.getAttribute("data-judged")) !== String(wk.nutrition.daysJudged) || (await nut.getAttribute("data-in-band")) !== String(wk.nutrition.daysInBand)) throw new Error("the nutrition tiles carry the query's days logged, judged and in band");
    if (wk.nutrition.daysLogged < 1 || !((await nut.textContent()) ?? "").includes(fmtMacro("cal", wk.nutrition.avgCal!))) throw new Error(`the week's average calories are the query's: ${wk.nutrition.avgCal}`);
    const tr = client.locator('[data-testid="week-training"]');
    if ((await tr.getAttribute("data-sessions")) !== String(wk.training.sessions) || (await tr.getAttribute("data-sets")) !== String(wk.training.sets) || (await tr.getAttribute("data-prs")) !== String(wk.training.prs) || wk.training.prs < 1) throw new Error(`the training tiles carry the query's sessions, sets and PRs (${wk.training.prs} PRs this week)`);
    const wt = client.locator('[data-testid="week-weight"]');
    if ((await wt.getAttribute("data-days")) !== String(wk.weigh.days) || wk.weigh.days < 1 || !((await wt.textContent()) ?? "").includes(fmtM("weight", wk.weigh.avg!, "lb"))) throw new Error("the weight tile carries the week's average");
    if (!(await client.locator('[data-testid="week-pace"]').count())) throw new Error("a weight goal shows its pace");
    await noSideScroll(client, "/body/week");
    await client.locator('a[aria-label="Previous week"]').click();
    await client.waitForURL(/week=/);
    await client.locator('[data-testid="week-label"]').waitFor({ timeout: 30000 });
    if (!((await client.locator('[data-testid="week-label"]').textContent()) ?? "").startsWith("Week of")) throw new Error("last week is reachable and named by its date");
    console.log(`✓ the week: ${wk.nutrition.daysLogged} of ${wk.nutrition.daysPassed} days logged (${wk.nutrition.daysInBand} of ${wk.nutrition.daysJudged} in band), ${wk.training.sessions} sessions, ${wk.training.sets} sets, ${wk.training.prs} PRs, average ${wk.weigh.avg} lb over ${wk.weigh.days} weigh-ins, the goal's pace shown; last week reachable`);




    // ── Private: the coach sees nothing, and a coach's export never has Body. ──
    await coach.goto(`${base}/coach/${mem.id}`);
    if (await coach.locator('[data-testid="coach-body-link"]').count()) throw new Error("the client page shows no Body card while private");
    await coach.goto(`${base}/coach/${mem.id}/body`);
    if (!(await coach.locator('[data-testid="coach-body-private"]').count()) || (await coach.locator('[data-testid="body-tiles"]').count())) throw new Error("the coach's Body view says private and shows nothing");
    const coachDump = (await (await coach.request.get(`${base}/api/export?format=json&user=${maya.id}`)).json()) as Record<string, unknown>;
    if (Object.keys(coachDump).some((k) => k.startsWith("body_"))) throw new Error("a coach's export of a client carries no Body section");
    console.log("✓ private: no Body card, the coach's view says private, and the coach's export has no Body section");

    // ── Shared: read-only for the coach, plus a comment the client sees. ──
    await client.goto(`${base}/body/settings`);
    await press(client, '[data-testid="body-share-toggle"]', async () => /: On/.test(await client.locator('[data-testid="body-share-state"]').innerText()), "sharing on");
    await coach.goto(`${base}/coach/${mem.id}`);
    await coach.locator('[data-testid="coach-body-link"]').click();
    await coach.waitForURL(/\/body/);
    const coachCal = await coach.locator('[data-testid="body-tile-cal"]').innerText();
    if (!coachCal.includes(fmtMacro("cal", totals.cal))) throw new Error(`the coach reads the client's day: "${coachCal}"`);
    if (await coach.locator('[data-testid="body-log-meal"], [data-testid="body-log-food"], [data-testid="body-share-toggle"], [data-testid="body-no-targets"], [data-testid="training-log-form"]').count()) throw new Error("the coach's view has no way to log or change anything");
    if (!((await coach.locator('[data-testid="coach-composition"]').textContent()) ?? "").includes("150.4 lb")) throw new Error("the coach reads the day's weigh-in while shared");
    const coachTraining = (await coach.locator('[data-testid="coach-training"]').textContent()) ?? "";
    if (!coachTraining.includes("Bench press") || !coachTraining.includes("190 × 5 🏆") || !coachTraining.includes("10 reps")) throw new Error(`the coach reads the day's workout, PR marked: "${coachTraining}"`);
    const note = `Great day ${Date.now()}`;
    await fillExact(coach, '[data-testid="coach-body-comment"]', note);
    await press(coach, '[data-testid="coach-body-comment-send"]', async () => (await coach.locator('[data-testid="coach-body-comments"]').count()) > 0 && (await coach.locator('[data-testid="coach-body-comments"]').innerText()).includes(note), "the comment");
    await client.goto(`${base}/body`);
    if (!(await client.locator('[data-testid="body-comments"]').innerText()).includes(note)) throw new Error("the client sees the coach's comment on the day");
    console.log("✓ shared: the coach reads the day (no log or settings controls) and comments; the client sees the comment");

    // ── Revoked: nothing again. ──
    await client.goto(`${base}/body/settings`);
    await press(client, '[data-testid="body-share-toggle"]', async () => /: Off/.test(await client.locator('[data-testid="body-share-state"]').innerText()), "sharing off");
    await coach.goto(`${base}/coach/${mem.id}/body`);
    if (!(await coach.locator('[data-testid="coach-body-private"]').count()) || (await coach.locator('[data-testid="body-tiles"]').count())) throw new Error("revoking hides the client's Body from the coach again");
    await coach.goto(`${base}/coach/${mem.id}`);
    if (await coach.locator('[data-testid="coach-body-link"]').count()) throw new Error("revoking removes the Body card");
    const events = await db.query.bodyShareEvents.findMany({ where: mine(schema.bodyShareEvents) });
    if (events.length !== 2 || events.filter((e) => e.shared).length !== 1) throw new Error(`both changes are logged: ${events.length}`);
    if ((await client.locator('[data-testid="body-share-log"] li').count()) !== 2) throw new Error("the member sees both changes in the sharing log");
    console.log("✓ revoked: the coach's view is private again, the card is gone, and the log holds both changes");

    // ── "Let AI use my Body data" (rev 219): off by default; on, AI gets the numbers; off again, nothing on the next request. ──
    const { bodyAiContext } = await import("@/lib/queries/body");
    const viewerFor = async () => {
      const [user, workspace, membership] = await Promise.all([db.query.users.findFirst({ where: eq(schema.users.id, maya.id) }), db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) }), db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) })]);
      return { user: user!, workspace: workspace!, membership: membership!, role: "client" as const, tz: membership!.timezone || workspace!.timezone, today, hour: 12, actor: user!, switchedInto: null };
    };
    if ((await bodyAiContext(await viewerFor())) !== null) throw new Error("with the AI switch off (the default), AI gets no Body data");
    await client.goto(`${base}/body/settings`);
    await press(client, '[data-testid="body-ai-toggle"]', async () => /: On/.test(await client.locator('[data-testid="body-ai-state"]').innerText()), "AI use on");
    if (!/: Off/.test(await client.locator('[data-testid="body-share-state"]').innerText())) throw new Error("the AI switch is independent of coach sharing");
    const aiText = await bodyAiContext(await viewerFor());
    if (!aiText || !aiText.includes(MEALS[0].name) || !aiText.includes(`${fmtMacro("cal", totals.cal)} cal`)) throw new Error(`with the switch on, AI gets today's numbers and logged meals: ${aiText}`);
    if (aiText.includes(note)) throw new Error("the coach's comment never goes to AI");
    if (!aiText.includes("Latest weigh-in") || !aiText.includes("150.4 lb")) throw new Error(`with the switch on, AI gets the latest weigh-in: ${aiText}`);
    if (!aiText.includes(`${ROUTINE.name}: Bench press 190 × 5`) || !aiText.includes("Bench press 185 × 5, 185 × 5")) throw new Error(`with the switch on, AI gets the week's workouts: ${aiText}`);
    // Another viewer (the coach) never gets it, switch or not.
    const theCoach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachViewer = { ...(await viewerFor()), user: theCoach, actor: theCoach, role: "coach" as const };
    if ((await bodyAiContext(coachViewer)) !== null && (await bodyAiContext(coachViewer))!.includes(MEALS[0].name)) throw new Error("a coach's session never gets the client's Body data for AI");
    // Body's MCP tools (phase 4), called with the member's viewer: reads from the day, draft-writes on yesterday, a refusal with the
    // names to pick from, and nothing of the coach's comment. Then, with the switch off, every tool refuses.
    await import("@/lib/mcp/tools/index");
    const { allTools } = await import("@/lib/mcp/registry");
    const tool = (name: string) => allTools().find((t) => t.name === name)!;
    const todayTool = await tool("body_today").handler(await viewerFor(), {});
    if (!todayTool.text.includes(MEALS[0].name) || !todayTool.text.includes(`${fmtMacro("cal", totals.cal)} cal`) || !todayTool.text.includes(ROUTINE.name) || !todayTool.text.includes("150.4 lb")) throw new Error(`body_today reads the day, the workout and the weigh-in: ${todayTool.text}`);
    if (todayTool.text.includes(note)) throw new Error("the coach's comment never goes through a tool");
    const foodsTool = await tool("body_foods").handler(await viewerFor(), {});
    if (!foodsTool.text.includes(fx("egg").name) || !foodsTool.text.includes(MEALS[1].name)) throw new Error("body_foods lists the foods and meals");
    const mealTool = await tool("body_log_meal").handler(await viewerFor(), { meal: MEALS[0].name.toLowerCase(), slot: "lunch", date: yesterday });
    // Yesterday already holds the pantry section's raw steak; the meal is the one entry with a meal id.
    const yEntries = await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.date, yesterday)) });
    const yMeal = yEntries.filter((e) => e.mealId);
    if (yMeal.length !== 1 || yMeal[0].name !== MEALS[0].name || yMeal[0].slot !== "Lunch" || !mealTool.text.includes(`Logged ${MEALS[0].name} to Lunch`)) throw new Error(`body_log_meal logs the meal by name into the member's own slot: ${mealTool.text}`);
    const foodTool = await tool("body_log_food").handler(await viewerFor(), { food: "lean steak", qty: 100, unit: "g", slot: "Dinner", date: yesterday });
    const steakRow = (await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.date, yesterday)) })).find((e) => e.mealId === null && Math.abs(e.items[0].qty - 3.5274) < 0.01);
    if (!steakRow || !foodTool.text.includes("100 g")) throw new Error(`body_log_food converts grams to the food's ounces: ${foodTool.text}`);
    const setTool = await tool("body_log_set").handler(await viewerFor(), { exercise: "bench", weight: 180, reps: 8, date: yesterday });
    if (!setTool.text.includes("180 × 8") || (await db.query.bodySets.findMany({ where: and(mine(schema.bodySets), eq(schema.bodySets.date, yesterday)) })).length !== 3) throw new Error(`body_log_set adds a set to yesterday's session: ${setTool.text}`);
    const weighTool = await tool("body_log_weigh_in").handler(await viewerFor(), { weight: 151.2, bodyFat: 21.5, date: yesterday, time: "07:00" });
    if (!weighTool.text.includes("151.2 lb") || !weighTool.text.includes("21.5%")) throw new Error(`body_log_weigh_in logs the reading: ${weighTool.text}`);
    const refused = await tool("body_log_food").handler(await viewerFor(), { food: "unicorn", qty: 1 }).then(() => "logged", (e: Error) => e.message);
    if (!refused.startsWith('No food called "unicorn"') || !refused.includes(fx("egg").name)) throw new Error(`an unknown food is refused with the names to pick from: ${refused}`);
    const trainTool = await tool("body_training").handler(await viewerFor(), { exercise: "Bench press" });
    if (!trainTool.text.includes("PR 190 × 5")) throw new Error(`body_training gives an exercise's history: ${trainTool.text}`);
    const wiTool = await tool("body_weigh_ins").handler(await viewerFor(), {});
    if (!wiTool.text.includes("7-day average") || !wiTool.text.includes("150.4 lb")) throw new Error(`body_weigh_ins gives the trend: ${wiTool.text}`);
    await press(client, '[data-testid="body-ai-toggle"]', async () => /: Off/.test(await client.locator('[data-testid="body-ai-state"]').innerText()), "AI use off");
    if ((await bodyAiContext(await viewerFor())) !== null) throw new Error("switching it off stops it on the next request");
    const offAnswer = await tool("body_today").handler(await viewerFor(), {}).then(() => "answered", (e: Error) => e.message);
    if (!offAnswer.includes("AI switch is off")) throw new Error(`with the switch off, every Body tool refuses: ${offAnswer}`);
    const aiLog = await client.locator('[data-testid="body-share-log"] li[data-kind="ai"]').count();
    const aiEvents = (await db.query.bodyShareEvents.findMany({ where: mine(schema.bodyShareEvents) })).filter((e) => e.kind === "ai");
    if (aiLog !== 2 || aiEvents.length !== 2) throw new Error(`both AI changes are logged and shown: ${aiEvents.length} logged, ${aiLog} shown`);
    console.log("✓ AI use: off by default (no Body data), on gives today's numbers and meals but never the coach's comment, off again stops it on the next request; independent of coach sharing; both changes logged. MCP tools: the day, foods, a meal, a food in grams, a set and a weigh-in logged on yesterday, an unknown food refused with the names, an exercise's history, the trend; refused with the switch off");

    // ── The member's own export, then delete-all. ──
    const own = (await (await client.request.get(`${base}/api/export?format=json&scope=body`)).json()) as Record<string, unknown[]>;
    if (!(own.body_daily ?? []).length || (own.body_goals ?? []).length !== 1) throw new Error("the member's Body export has their weigh-ins and goals");
    if ((own.body_sets ?? []).length !== 6 || (own.body_exercises ?? []).length !== 2 || (own.body_routines ?? []).length !== 1 || (own.body_sessions ?? []).length !== 2) throw new Error("the member's Body export has their workouts");
    if (!(own.body_pantry ?? []).length || (own.body_yields ?? []).length !== 1) throw new Error("the member's Body export has their pantry and weighings");
    if ((own.body_entries ?? []).length !== 6 || (own.body_foods ?? []).length !== FOODS.length || !own.body_settings?.length || Object.keys(own).some((k) => k === "leads" || k === "tasks")) throw new Error("the member's Body export has their Body data and only that");
    // Download and Delete are two separate cards (rev 230); the confirm stays shut until DELETE is typed exactly.
    if (!(await client.locator('#download [data-testid="body-export"]').count()) || (await client.locator('#download [data-testid="body-erase"]').count()) || !(await client.locator('[data-testid="body-delete-card"] [data-testid="body-erase"]').count())) throw new Error("Download and Delete sit in separate cards");
    await noSideScroll(client, "/body/settings with its data cards");
    await fillExact(client, '[data-testid="body-erase-confirm"]', "delete");
    if (!(await client.locator('[data-testid="body-erase"]').isDisabled())) throw new Error("the confirm stays shut until DELETE is typed exactly");
    await fillExact(client, '[data-testid="body-erase-confirm"]', "DELETE");
    if (await client.locator('[data-testid="body-erase"]').isDisabled()) throw new Error("typing DELETE opens the confirm");
    await client.locator('[data-testid="body-erase"]').click();
    await Promise.all([client.waitForURL(/erased=1/), client.locator('dialog[open] [data-testid="confirm-delete-yes"]').click()]);
    const left = await count();
    if (left !== 0) throw new Error(`delete-all removes every Body row, ${left} left`);
    if (!(await client.locator('[data-testid="body-erased"]').count())) throw new Error("the page says it's deleted");
    console.log("✓ the member's export holds their Body data alone; delete-all removes every Body row");

    // ── The owner's beta switch (rev 209): the workspace owner turns Body on for themselves from Settings; nobody else sees it. ──
    const coachUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachMem = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachUser.id), eq(schema.memberships.workspaceId, mem.workspaceId)) }))!;
    const betaEvents = async () => (await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, coachUser.id), eq(schema.syncEvents.provider, "account")) })).filter((e) => e.event.startsWith("body.beta_"));
    if (coachMem.bodyEnabled) throw new Error("the owner's Body starts off");
    const onBefore = (await db.query.memberships.findMany({ where: eq(schema.memberships.bodyEnabled, true) })).map((m) => m.id).sort();
    await coach.goto(`${base}/settings`);
    await press(coach, '[data-testid="body-beta-toggle"]', async () => /: On/.test(await coach.locator('[data-testid="body-beta-state"]').innerText()), "the owner's Body on");
    if (!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coachMem.id) }))!.bodyEnabled) throw new Error("the switch sets the owner's own membership");
    const onAfter = (await db.query.memberships.findMany({ where: eq(schema.memberships.bodyEnabled, true) })).map((m) => m.id).sort();
    if (JSON.stringify(onAfter) !== JSON.stringify([...onBefore, coachMem.id].sort())) throw new Error(`the switch touches no other membership: ${onBefore.length} on before, ${onAfter.length} after`);
    await coach.goto(`${base}/more`);
    await coach.locator('main a[href="/today"]').waitFor({ timeout: 30000 });
    if (!(await coach.locator('main a[href="/body"]').count())) throw new Error("with the switch on, the owner's menu has Body");
    await coach.goto(`${base}/settings`);
    await press(coach, '[data-testid="body-beta-toggle"]', async () => /: Off/.test(await coach.locator('[data-testid="body-beta-state"]').innerText()), "the owner's Body off");
    const logged = (await betaEvents()).map((e) => e.event).sort();
    if (JSON.stringify(logged) !== JSON.stringify(["body.beta_off", "body.beta_on"])) throw new Error(`both switches are logged: ${JSON.stringify(logged)}`);
    await client.goto(`${base}/settings`);
    await client.locator('main h1').first().waitFor({ timeout: 30000 });
    if (await client.locator('[data-testid="body-beta-toggle"]').count()) throw new Error("a client never sees the beta switch");
    // A second coach in the same workspace, joined after the owner: no switch either.
    const { hashPassword } = await import("@/lib/password");
    const { newId } = await import("@/lib/ids");
    const second = { id: newId(), email: `second-coach-${Date.now()}@example.com` };
    await db.insert(schema.users).values({ id: second.id, email: second.email, name: "Second Coach", passwordHash: await hashPassword("demo1234") });
    await db.insert(schema.memberships).values({ id: newId(), workspaceId: mem.workspaceId, userId: second.id, role: "coach" });
    const other = await (await browser.newContext()).newPage();
    await login(other, second.email);
    await other.goto(`${base}/settings`);
    await other.locator('main h1').first().waitFor({ timeout: 30000 });
    if (await other.locator('[data-testid="body-beta-toggle"]').count()) throw new Error("another coach never sees the beta switch");
    console.log("✓ the beta switch: the owner turned Body on and off for themselves from Settings, both logged; no client and no second coach sees it");

    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Body walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
