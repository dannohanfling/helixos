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
  const { todayInTz } = await import("@/lib/dates");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) });
  const today = todayInTz(mem.timezone || ws!.timezone);
  const BODY = [schema.bodyEntries, schema.bodyDays, schema.bodyComments, schema.bodyMeals, schema.bodyFoods, schema.bodyDayTypes, schema.bodyShareEvents, schema.bodySettings];
  const mine = <T extends (typeof BODY)[number]>(t: T) => and(eq(t.workspaceId, mem.workspaceId), eq(t.userId, maya.id));
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
    for (const path of ["/body", "/body/foods", "/body/settings"]) await notFoundPage(client, path);
    const offExport = await client.request.get(`${base}/api/export?format=json&scope=body`);
    if (offExport.status() !== 404) throw new Error(`the Body export is a 404 while Body is off, got ${offExport.status()}`);
    await client.goto(`${base}/more`);
    // The page streams: wait for the menu itself before reading what's in it.
    await client.locator('main a[href="/today"]').waitFor({ timeout: 30000 });
    if ((await client.locator("main a").count()) < 10) throw new Error("the More page lists the menu to read");
    if (await client.locator('a[href="/body"]').count()) throw new Error("no Body entry anywhere in the menu while Body is off");
    await client.goto(`${base}/today`);
    await client.locator("main h1, main h2").first().waitFor({ timeout: 30000 });
    if (await client.locator('[data-testid="today-body"]').count()) throw new Error("no Body line on Today while Body is off");
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
    if (!(await client.locator('main a[href="/body"]').count())) throw new Error("the menu has Body once it's on");
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
    await client.goto(`${base}/today`);
    await client.locator("main h1, main h2").first().waitFor({ timeout: 30000 });
    if (await client.locator('[data-testid="today-body"]').count()) throw new Error("the Today line waits for targets");
    console.log("✓ the blank page: the checklist with every step open, totals only with Set targets, Add your first food, no What fits, no Today line");

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
      if (!(await form.isVisible())) await client.locator("summary", { hasText: "New food" }).click();
      for (const [name, value] of [["name", f.name], ["unit", f.unit], ["cal", f.cal], ["p", f.p], ["f", f.f], ["c", f.c]] as const) await fillExact(client, `[data-testid="body-new-food"] input[name="${name}"]`, String(value));
      const before = await foodRows();
      await press(client, '[data-testid="body-new-food"] button[type="submit"]', async () => (await foodRows()) === before + 1, `${f.name} added`);
    }
    const foods = await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) });
    const idOf = (key: string) => foods.find((f) => f.name === fx(key).name)!.id;
    for (const key of FOODS) {
      const f = foods.find((x) => x.name === fx(key).name);
      if (!f || f.cal !== fx(key).cal || f.p !== fx(key).p || f.f !== fx(key).f || f.c !== fx(key).c || f.unit !== fx(key).unit) throw new Error(`${fx(key).name} saved as typed: ${JSON.stringify(f)}`);
    }
    const mealRows = () => client.locator('[data-testid="body-meal-list"] > li').count();
    for (const meal of MEALS) {
      const form = client.locator('[data-testid="body-new-meal"]');
      if (!(await form.isVisible())) await client.locator("summary", { hasText: "New meal" }).click();
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
    for (const [key, qty] of [["lean-steak", "10"], ["egg-whites-cup", "1"]] as const) {
      const form = client.locator('[data-testid="body-log-food-form"]');
      await form.locator('select[name="foodId"]').selectOption(idOf(key));
      await fillExact(client, '[data-testid="body-log-food-form"] input[name="qty"]', qty);
      await form.locator('select[name="slot"]').selectOption("Dinner");
      const before = await entryCount(client);
      await press(client, '[data-testid="body-log-food"]', async () => (await entryCount(client)) === before + 1, `${key} logged`);
    }
    const entries = await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.date, today)) });
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
    console.log(`✓ lunch + a lean steak dinner = ${fmtMacro("cal", totals.cal)} / ${totals.p} P / ${totals.f} F / ${totals.c} C: every tile ✅ as the engine says`);

    await client.goto(`${base}/today`);
    const line = (await client.locator('[data-testid="today-body"]').textContent()) ?? "";
    if (!line.includes("Every day") || !line.includes(`${fmtMacro("cal", totals.cal)} of`)) throw new Error(`Today's Body line names the day type and the calories: "${line}"`);
    await noSideScroll(client, "/today");
    console.log(`✓ Today carries one Body line once targets exist: "${line.replace(/\s+/g, " ").trim()}"`);

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
    if (await coach.locator('[data-testid="body-log-meal"], [data-testid="body-log-food"], [data-testid="body-share-toggle"], [data-testid="body-no-targets"]').count()) throw new Error("the coach's view has no way to log or change anything");
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

    // ── The member's own export, then delete-all. ──
    const own = (await (await client.request.get(`${base}/api/export?format=json&scope=body`)).json()) as Record<string, unknown[]>;
    if ((own.body_entries ?? []).length !== 3 || (own.body_foods ?? []).length !== FOODS.length || !own.body_settings?.length || Object.keys(own).some((k) => k === "leads" || k === "tasks")) throw new Error("the member's Body export has their Body data and only that");
    await fillExact(client, '[data-testid="body-erase-confirm"]', "DELETE");
    await client.locator('[data-testid="body-erase"]').click();
    await Promise.all([client.waitForURL(/erased=1/), client.locator('dialog[open] [data-testid="confirm-delete-yes"]').click()]);
    const left = await count();
    if (left !== 0) throw new Error(`delete-all removes every Body row, ${left} left`);
    if (!(await client.locator('[data-testid="body-erased"]').count())) throw new Error("the page says it's deleted");
    console.log("✓ the member's export holds their Body data alone; delete-all removes every Body row");

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
