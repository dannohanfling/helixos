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
  const { and, eq, gte, inArray } = await import("drizzle-orm");
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
    // Rev 320: while it's off, the HumanOS section holds exactly one entry, the way to the switch, and nothing of its pages.
    if ((await client.locator('main a[href="/settings#humanos"]').count()) !== 1) throw new Error("while HumanOS is off, the menu's HumanOS section is one 'Turn on HumanOS' entry");
    if ((await client.locator('main a[href^="/body"]').count()) !== 0) throw new Error("no HumanOS page in the menu while it is off");
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
      if (key === FOODS[0]) {
        // Rev 444: a box it can't read is refused in place: only that box is marked, and everything typed is still there.
        await fillExact(client, '[data-testid="body-new-food"] input[name="p"]', "lots");
        await press(client, '[data-testid="body-new-food"] button[type="submit"]', async () => (await client.locator('[data-testid="body-new-food"] [data-testid="field-error"]').count()) === 1, "the protein box marked");
        const marked = await client.locator('[data-testid="body-new-food"] [aria-invalid="true"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
        const kept = await client.locator('[data-testid="body-new-food"] input[name="name"]').inputValue();
        const keptP = await client.locator('[data-testid="body-new-food"] input[name="p"]').inputValue();
        if (marked.join() !== "p" || kept !== f.name || keptP !== "lots" || (await foodRows()) !== before) throw new Error(`a refused food keeps what was typed and marks only protein: ${JSON.stringify({ marked, kept, keptP })}`);
        await fillExact(client, '[data-testid="body-new-food"] input[name="p"]', String(f.p));
      }
      if (key === FOODS[1]) {
        // A long form keeps a draft: the page reloaded before Save brings back what was typed.
        await client.waitForTimeout(500);
        await client.reload();
        await openDisclosure(client, "New food", '[data-testid="body-new-food"]');
        await client.locator('[data-testid="body-new-food"] [data-testid="draft-restored"][data-kind="draft"]').waitFor({ timeout: 10000 });
        if ((await client.locator('[data-testid="body-new-food"] input[name="name"]').inputValue()) !== f.name) throw new Error("the new food's draft comes back after a reload");
      }
      await press(client, '[data-testid="body-new-food"] button[type="submit"]', async () => (await foodRows()) === before + 1, `${f.name} added`);
      if (key === FOODS[0]) {
        // The save after a refusal leaves the refusal behind, so nothing it saved is put back into the empty form.
        for (let i = 0; i < 50 && client.url().includes("error="); i++) await client.waitForTimeout(100);
        await client.waitForTimeout(500);
        if (client.url().includes("error=") || (await client.locator('[data-testid="body-new-food"] input[name="name"]').inputValue())) throw new Error(`the corrected save clears the refusal and the form: ${client.url()}`);
      }
    }
    await client.reload();
    if (await client.locator('[data-testid="draft-restored"]:visible').count()) throw new Error("a saved food leaves no draft behind");
    console.log("✓ rev 444 on Foods: protein typed as a word is refused with only that box marked and the rest kept; a reloaded form brings its draft back; a save drops it");
    const foods = await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) });
    if ((await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, fx("white-cheddar").name)) }))?.capTag !== "cheese") throw new Error("the tag field saves a cap tag");
    if ((await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, fx("egg").name)) }))?.sodium !== EGG_SODIUM) throw new Error("sodium saves on the food");
    const idOf = (key: string) => foods.find((f) => f.name === fx(key).name)!.id;
    for (const key of FOODS) {
      const f = foods.find((x) => x.name === fx(key).name);
      if (!f || f.cal !== fx(key).cal || f.p !== fx(key).p || f.f !== fx(key).f || f.c !== fx(key).c || f.unit !== storedUnit(fx(key).unit)) throw new Error(`${fx(key).name} saved as typed: ${JSON.stringify(f)}`);
    }
    // ── Find a food (rev 237 phase 13, B8): by name against the USDA mock, by barcode against the Open Food Facts mock. ──
    {
      const { fromOff, fromUsda, foodFromFound, fmtPer100 } = await import("@/lib/engine/body-find");
      const { records: foodRecords } = await import("../scripts/fixtures/foods");
      const { spawn: spawnFoods } = await import("node:child_process");
      const foodsMock = spawnFoods("npx", ["tsx", "scripts/mock-foods.ts", "4073"], { stdio: "ignore", detached: true });
      try {
        for (let i = 0; i < 100; i++) {
          try {
            await fetch("http://localhost:4073/__calls");
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        await client.locator('[data-testid="find-food-link"]').click();
        await client.waitForURL(/\/body\/foods\/find/);
        if (await client.locator('[data-testid="find-no-key"]').count()) throw new Error("with a USDA key on the server, the page doesn't say search is unset");
        await fillExact(client, '[data-testid="find-search"] input[name="q"]', "chicken breast");
        await Promise.all([client.waitForURL(/q=chicken\+breast/), client.locator('[data-testid="find-search"] button[type="submit"]').click()]);
        const expectedHits = foodRecords.usda.filter((f) => f.description.toLowerCase().includes("chicken") && f.description.toLowerCase().includes("breast")).map((f) => fromUsda(f)!);
        const hitNames = await client.locator('[data-testid="find-result-name"]').allInnerTexts();
        if (JSON.stringify(hitNames) !== JSON.stringify(expectedHits.map((f) => f.name))) throw new Error(`the results are the mock's matches, in its order: ${JSON.stringify(hitNames)}`);
        if ((await client.locator('[data-testid="find-result-per100"]').first().innerText()) !== fmtPer100(expectedHits[0].per100, expectedHits[0])) throw new Error("each result shows its figures per 100 g");
        const foodUnit = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!.foodUnit;
        const wantSaved = foodFromFound(expectedHits[0], foodUnit);
        await Promise.all([client.waitForURL(/saved=/), client.locator('[data-testid="find-save"]').first().click()]);
        await client.locator('[data-testid="find-saved"]').waitFor();
        const savedFood = await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, wantSaved.name)) });
        if (!savedFood || savedFood.unit !== foodUnit || savedFood.cal !== wantSaved.cal || savedFood.p !== wantSaved.p || savedFood.f !== wantSaved.f || savedFood.c !== wantSaved.c || savedFood.sodium !== wantSaved.sodium || savedFood.basis !== "raw" || savedFood.section !== "meat") throw new Error(`the saved food is per ${foodUnit}, basis raw, section meat: ${JSON.stringify(savedFood)}`);
        // The same Save again updates, never doubles.
        await client.goBack();
        await client.locator('[data-testid="find-save"]').first().waitFor();
        await Promise.all([client.waitForURL(/saved=/), client.locator('[data-testid="find-save"]').first().click()]);
        if ((await db.query.bodyFoods.findMany({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, wantSaved.name)) })).length !== 1) throw new Error("saving the same result twice keeps one food");
        // By barcode, typed: the product, saved per the unit; an unknown code says not found; letters are refused before any call.
        const product = foodRecords.off[0];
        await client.goto(`${base}/body/foods/find`);
        await fillExact(client, '[data-testid="find-barcode"] input[name="code"]', product.code);
        await Promise.all([client.waitForURL(/code=/), client.locator('[data-testid="find-barcode"] button[type="submit"]').click()]);
        const wantOff = fromOff(product, product.code)!;
        if ((await client.locator('[data-testid="find-result-name"]').allInnerTexts()).join() !== wantOff.name) throw new Error("a barcode shows its one product");
        await Promise.all([client.waitForURL(/saved=/), client.locator('[data-testid="find-save"]').first().click()]);
        const savedOff = await db.query.bodyFoods.findFirst({ where: and(mine(schema.bodyFoods), eq(schema.bodyFoods.name, foodFromFound(wantOff, foodUnit).name)) });
        if (!savedOff || savedOff.section !== "dairy" || savedOff.cal !== foodFromFound(wantOff, foodUnit).cal) throw new Error(`the product saved per ${foodUnit}, section dairy: ${JSON.stringify(savedOff)}`);
        await client.goto(`${base}/body/foods/find?code=99999999999`);
        if (!/No product with that barcode/.test(await client.locator('[data-testid="find-error"]').innerText())) throw new Error("an unknown barcode says not found");
        await client.goto(`${base}/body/foods/find?code=abc`);
        if (!/8 to 14 digits/.test(await client.locator('[data-testid="find-error"]').innerText())) throw new Error("letters are refused as a barcode");
        if (!(await client.locator('[data-testid="scan-start"]').count()) || (await client.locator('[data-testid="scan-video"]').count())) throw new Error("the scanner waits behind its button; no camera opens on load");
        const { calls: foodCalls } = (await (await fetch("http://localhost:4073/__calls")).json()) as { calls: { path: string }[] };
        if (foodCalls.filter((c) => c.path === "/fdc/v1/foods/search").length !== 1 || foodCalls.filter((c) => c.path.startsWith("/off/")).length !== 2) throw new Error(`one USDA search and two barcode lookups went out, and the refused code none: ${JSON.stringify(foodCalls)}`);
        await noSideScroll(client, "/body/foods/find?q=chicken+breast");
        console.log(`✓ find a food: "${expectedHits[0].name}" and "${wantOff.name}" saved from the mocks per ${foodUnit}, once each; not-found and bad codes refused; the scanner loads only on press`);
        // A record with gaps (Danno, rev 429): the ribeye's 0 kcal beside real macros becomes 4P + 9F + 4C, marked; its missing sodium reads —.
        const ribeyeRec = foodRecords.usda.find((f) => f.description.includes("ribeye"))!;
        const ribeye = fromUsda(ribeyeRec)!;
        await client.goto(`${base}/body/foods/find?q=ribeye`);
        const ribLine = client.locator('[data-testid="find-result-per100"]').first();
        await ribLine.waitFor({ timeout: 30000 });
        if ((await ribLine.getAttribute("data-estimated")) !== "macros" || (await ribLine.getAttribute("data-missing")) !== "sodium" || !(await ribLine.innerText()).startsWith("255 cal (estimated from macros)") || !(await ribLine.innerText()).includes("— mg sodium")) throw new Error(`a blank energy is estimated from the macros and marked, a blank sodium reads —: ${await ribLine.innerText()}`);
        await Promise.all([client.waitForURL(/saved=/), client.locator('[data-testid="find-save"]').first().click()]);
        if (!(await client.locator('[data-testid="find-saved-note"]').innerText()).includes("calories were estimated from the macros; sodium wasn't in the source")) throw new Error("the save says what was estimated and what was missing");
        console.log(`✓ USDA gaps: ${ribeye.name} reads ${ribeye.per100.cal} cal estimated from the macros and sodium —, and its save says so`);
        // The found foods leave again, so the rest of the walk sees the library it built by hand.
        await db.delete(schema.bodyFoods).where(and(mine(schema.bodyFoods), inArray(schema.bodyFoods.name, [wantSaved.name, foodFromFound(wantOff, foodUnit).name, foodFromFound(ribeye, foodUnit).name])));
      } finally {
        if (foodsMock.pid) process.kill(-foodsMock.pid);
      }
      await client.goto(`${base}/body/foods`);
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
    // Rev 296: "Add rows" grows the new-routine form from six rows to eight; the Training date picker jumps to a past day.
    await openDisclosure(client, "New routine", rForm);
    const rowsBefore = await client.locator(`${rForm} select[name$="_exercise"]`).count();
    await Promise.all([client.waitForURL(/rows=8/), client.locator(`${rForm} [data-testid="routine-add-rows"]`).click()]);
    await openDisclosure(client, "New routine", rForm);
    if (rowsBefore !== 6 || (await client.locator(`${rForm} select[name$="_exercise"]`).count()) !== 8) throw new Error(`Add rows takes the form from six rows to eight: ${rowsBefore} before`);
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-date-form"] input[name="date"]').fill(addDays(today, -1));
    await Promise.all([client.waitForURL(new RegExp(`date=${addDays(today, -1)}`)), client.locator('[data-testid="training-date-form"] button[type="submit"]').click()]);
    if ((await client.locator('[data-testid="training-date"]').innerText()).trim() !== "Yesterday") throw new Error("the date picker lands on the day asked");
    console.log("✓ Add rows grows the routine form; the date picker opens a past day on Training");

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
    // Rev 471: the finished session reads back in plain lines, the query's own, with the member's note; the bench, up to a PR at
    // one of three sets, keeps 190 for next time, and "Use next time" makes it the routine's target, opening the next first set.
    const { workoutReadFor } = await import("@/lib/queries/body");
    const readWant = (await workoutReadFor(mem.workspaceId, maya.id, today))!;
    const readShown = await client.locator('[data-testid="training-session"] [data-testid="workout-read-lines"] li').allTextContents();
    if (JSON.stringify(readShown) !== JSON.stringify(readWant.lines) || !readShown.some((l) => l.includes("Felt strong")) || !readShown.includes("New PR: Bench press.")) throw new Error(`the post-workout read is the query's: ${JSON.stringify(readShown)}`);
    const benchNext = client.locator('[data-testid="workout-read-next-item"][data-exercise="Bench press"]');
    if ((await benchNext.getAttribute("data-weight")) !== "190" || (await benchNext.getAttribute("data-add")) !== "0") throw new Error("one set of three planned keeps the weight for next time");
    await press(client, '[data-testid="workout-read-next-item"][data-exercise="Bench press"] [data-testid="workout-read-accept"]', async () => (await client.locator(`${card("Bench press")} [data-testid="training-target-weight"]`).count()) > 0, "the target taken");
    const pushDay = (await db.query.bodyRoutines.findMany({ where: mine(schema.bodyRoutines) })).find((r) => r.id === readWant.routineId);
    if (pushDay?.items.find((i) => i.exerciseId === exRows.find((r) => r.name === "Bench press")!.id)?.weight !== 190) throw new Error("Use next time sets the routine's target weight");
    await client.goto(`${base}/today`);
    if (!(await client.locator('[data-testid="today-workout-read"] [data-testid="workout-read-lines"] li').count())) throw new Error("Today shows the finished session's read");
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-finished"]').waitFor({ timeout: 30000 });
    console.log(`✓ post-workout read (rev 471): ${readWant.lines.length} lines, the query's own, the note in them; bench up to a PR keeps 190 for next time and Use next time makes it the routine's target; Today shows the read`);
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
    // Typed the way people write it (rev 444): the kilos read in the member's pounds, a decimal comma and a % sign.
    await weigh("67.857 kg", "20,6%", "07:10");
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
    // "1 lb" of a food counted per oz is 16 oz on the shelf (rev 444).
    await addToShelf(idOf("lean-steak"), "1 lb", "raw", addDays(today, 2));
    await addToShelf(idOf("egg"), "12", "raw", addDays(today, 10));
    if (!((await client.locator('[data-testid="pantry-soon"]').textContent()) ?? "").includes(fx("lean-steak").name)) throw new Error("the steak, use by in two days, is to use soon");
    // Par levels (rev 452): only foods that have one are listed; the rest are picked in "Add a par level".
    if ((await client.locator('[data-testid="pantry-par"]').count()) !== 0) throw new Error("with no par levels set, none are listed");
    const steakPar = `[data-testid="pantry-par"][data-food="${fx("lean-steak").name}"]`;
    const parAdd = client.locator('[data-testid="pantry-par-add"]');
    if (!(await parAdd.isVisible())) await client.locator("summary", { hasText: "Add a par level" }).click();
    await parAdd.locator('select[name="foodId"]').selectOption(idOf("lean-steak"));
    await fillExact(client, '[data-testid="pantry-par-add-qty"]', "24");
    await press(client, '[data-testid="pantry-par-add-save"]', async () => (await client.locator('[data-testid="pantry-gap"]').count()) > 0, "the gap to buy");
    if ((await client.locator('[data-testid="pantry-par"]').count()) !== 1 || (await client.locator(`${steakPar} input[name="par"]`).inputValue()) !== "24") throw new Error("the steak's par level is listed, and only it");
    if (await parAdd.locator(`option[value="${idOf("lean-steak")}"]`).count()) throw new Error("a food with a par level leaves the picker");
    // The layout at desktop and phone width: a par food's name on one line, the shelf's Food select at full width, the Unit placeholder whole.
    for (const width of [1280, 390]) {
      await client.setViewportSize({ width, height: 900 });
      if (!(await client.locator('[data-testid="pantry-add"]').isVisible())) await client.locator("summary", { hasText: "Add to the shelf" }).click();
      const layout = await client.evaluate(() => {
        const name = document.querySelector('[data-testid="pantry-par-name"]') as HTMLElement;
        const lineHeight = parseFloat(getComputedStyle(name).lineHeight) || 20;
        const form = document.querySelector('[data-testid="pantry-add"]') as HTMLElement;
        const food = form.querySelector('select[name="foodId"]') as HTMLElement;
        const unit = form.querySelector('[data-testid="pantry-unit"]') as HTMLInputElement;
        const probe = document.createElement("span");
        probe.style.font = getComputedStyle(unit).font;
        probe.style.position = "absolute";
        probe.style.whiteSpace = "nowrap";
        probe.textContent = unit.placeholder;
        document.body.appendChild(probe);
        const placeholder = probe.getBoundingClientRect().width;
        probe.remove();
        const pad = parseFloat(getComputedStyle(unit).paddingLeft) + parseFloat(getComputedStyle(unit).paddingRight);
        return { nameLines: Math.round(name.getBoundingClientRect().height / lineHeight), foodShare: food.getBoundingClientRect().width / form.getBoundingClientRect().width, unitFits: unit.clientWidth - pad >= placeholder };
      });
      if (layout.nameLines !== 1 || layout.foodShare < 0.95 || !layout.unitFits) throw new Error(`pantry layout at ${width}px: ${JSON.stringify(layout)}`);
    }
    await client.setViewportSize(PHONE);
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
    console.log("✓ pantry: 16 oz raw steak and 12 eggs on the shelf; the steak (use by in two days) to use soon on Pantry and Log; par 24 oz set from Add a par level (only that food listed after) gives 8 oz to buy; names on one line and Food at full width at 1280 and 390px; 16 → 9.8 oz weighed learns a 61% yield; 8 oz logged raw lands as 4.88 oz cooked and the shelf keeps 8 oz raw; the eggs used up by hand");
    // ── Shopping and Instacart (phase 10): a meal planned twice, the list as the engine computes it from the shelf and the par
    // levels, a line bought onto the shelf, a line skipped, the push to the mock Instacart with the link back and the order logged. ──
    const { shoppingList: listOf } = await import("@/lib/engine/body-shopping");
    const { spawn: spawnMock } = await import("node:child_process");
    const instacart = spawnMock("npx", ["tsx", "scripts/mock-instacart.ts", "4071"], { stdio: "ignore", detached: true });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          await fetch("http://localhost:4071/__calls");
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await client.goto(`${base}/body/pantry`);
      await client.locator('[data-testid="pantry-shopping-link"]').click();
      await client.waitForURL(/\/body\/shopping/);
      await client.locator('[data-testid="plan-empty"]').waitFor({ timeout: 30000 });
      const planMeal = (await db.query.bodyMeals.findMany({ where: mine(schema.bodyMeals) })).find((m) => m.name === MEALS[0].name)!;
      await client.locator('[data-testid="plan-meal"]').selectOption(planMeal.id);
      await fillExact(client, '[data-testid="plan-times"]', "2");
      await press(client, '[data-testid="plan-add"]', async () => (await client.locator('[data-testid="plan-line"]').count()) === 1, "the meal planned");
      if ((await client.locator('[data-testid="plan-line"]').getAttribute("data-times")) !== "2") throw new Error("the plan shows the meal twice");
      const shopFoods = (await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).filter((f) => !f.archivedAt);
      const shelfNow = await db.query.bodyPantry.findMany({ where: mine(schema.bodyPantry) });
      const expectedList = listOf(shopFoods, [{ times: 2, lines: planMeal.items.map((i) => ({ foodId: i.foodId, qty: i.qty })) }], shelfNow);
      if (!expectedList.lines.length) throw new Error("the fixture's plan leaves something to buy");
      const summary = client.locator('[data-testid="shopping-summary"]');
      if ((await summary.getAttribute("data-lines")) !== String(expectedList.lines.length)) throw new Error(`the list has the engine's ${expectedList.lines.length} lines: ${await summary.getAttribute("data-lines")}`);
      for (const l of expectedList.lines) if ((await client.locator(`[data-testid="shopping-line"][data-food="${l.name}"]`).getAttribute("data-to-buy")) !== String(l.toBuy)) throw new Error(`${l.name}: ${l.toBuy} ${l.unit} to buy, as the engine says`);
      const parLine = expectedList.lines.find((l) => l.why !== "plan");
      if (!parLine) throw new Error("the steak's par level puts it on the list");
      await noSideScroll(client, "/body/shopping");
      // Bought: the first line's amount lands on the shelf, bought today.
      const first = expectedList.lines[0];
      const shelfBefore = shelfNow.length;
      await press(client, `[data-testid="shopping-line"][data-food="${first.name}"] [data-testid="shopping-bought"]`, async () => (await db.query.bodyPantry.findMany({ where: mine(schema.bodyPantry) })).length === shelfBefore + 1, "the line bought onto the shelf");
      const boughtRow = (await db.query.bodyPantry.findMany({ where: mine(schema.bodyPantry) })).find((it) => it.boughtOn === today && it.foodId === first.foodId);
      if (!boughtRow || boughtRow.qty !== first.toBuy || boughtRow.location !== "fridge") throw new Error("the bought line is on the shelf in its amount, in the fridge, bought today");
      // The refreshed page lands a beat after the action: wait for the list to shrink rather than read it once.
      let afterBought = expectedList.lines.length;
      for (let i = 0; i < 100 && afterBought >= expectedList.lines.length; i++) {
        await client.waitForTimeout(100);
        afterBought = Number(await client.locator('[data-testid="shopping-summary"]').getAttribute("data-lines"));
      }
      if (afterBought >= expectedList.lines.length) throw new Error("a bought line leaves the list");
      // Skip a line for this view only, then push the rest to Instacart.
      const skipCount = await client.locator('[data-testid="shopping-skip"]').count();
      if (skipCount) {
        await client.locator('[data-testid="shopping-skip"]').first().click();
        await client.waitForURL(/skip=/);
        await client.locator('[data-testid="shopping-summary"]').waitFor({ timeout: 30000 });
        if (Number(await client.locator('[data-testid="shopping-summary"]').getAttribute("data-lines")) !== afterBought - 1) throw new Error("a skipped line leaves this view");
      }
      const sentLines = Number(await client.locator('[data-testid="shopping-summary"]').getAttribute("data-lines"));
      if (!sentLines) throw new Error("something is left to send");
      // Danno, rev 429: Instacart takes no new partners, so the button reads "coming soon", is disabled, and nothing is sent or logged.
      const soon = client.locator('[data-testid="instacart-push"]');
      if ((await soon.innerText()).trim() !== "Instacart: coming soon" || !(await soon.isDisabled()) || !(await client.locator('[data-testid="instacart-soon"]').innerText()).includes("Instacart isn't taking new partners yet; your list works without it.")) throw new Error("the Instacart button reads coming soon, disabled, with its line");
      const { calls } = (await (await fetch("http://localhost:4071/__calls")).json()) as { calls: unknown[] };
      if (calls.length || (await db.query.bodyOrders.findMany({ where: mine(schema.bodyOrders) })).length) throw new Error("nothing goes to Instacart and nothing is logged");
      console.log(`✓ shopping: ${MEALS[0].name} planned twice gives the engine's ${expectedList.lines.length} lines (the steak's par among them); ${first.name} bought onto the shelf; a line skipped; ${sentLines} lines left, Instacart reads coming soon and nothing was sent`);
    } finally {
      if (instacart.pid) process.kill(-instacart.pid);
    }

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




    // ── Phase 8 (B7): habits from the starter list and the member's own, one tap, the streak that forgives one miss a week, the
    // chips on Today; sleep logged and replaced; the health log, marked on Training, resolved, reopened; the week's tiles. ──
    const { streak: streakOf } = await import("@/lib/engine/body-habits");
    const { sleepWeek } = await import("@/lib/engine/body-recovery");
    const { weekday } = await import("@/lib/dates");
    const { habitsDay } = await import("@/lib/queries/body");
    const { newId: freshId } = await import("@/lib/ids");
    await client.goto(`${base}/body/practices`);
    await client.locator('[data-testid="habit-starters"]').waitFor({ timeout: 30000 });
    if (!(await client.locator('[data-testid="habits-empty"]').count())) throw new Error("Practices starts empty, with the starter list");
    if ((await client.locator('[data-testid="habit-starter"]').count()) !== 14) throw new Error("the starter list has its fourteen");
    await press(client, '[data-testid="habit-starter"][data-name="Breathwork"]', async () => (await client.locator('[data-testid="habit"][data-name="Breathwork"]').count()) > 0, "Breathwork added");
    await press(client, '[data-testid="habit-starter"][data-name="Meditation"]', async () => (await client.locator('[data-testid="habit"][data-name="Meditation"]').count()) > 0, "Meditation added");
    if ((await client.locator('[data-testid="habit-starter"]').count()) !== 12) throw new Error("an added starter leaves the list");
    await client.locator("summary", { hasText: "Your own" }).click();
    await fillExact(client, '[data-testid="habit-new-form"] input[name="name"]', "Evening walk");
    await client.locator('[data-testid="habit-new-form"] select[name="kind"]').selectOption("count");
    await fillExact(client, '[data-testid="habit-new-form"] input[name="target"]', "6000");
    await fillExact(client, '[data-testid="habit-new-form"] input[name="unit"]', "steps");
    for (const d of [1, 2, 3, 4, 5]) await client.locator(`[data-testid="habit-new-form"] input[name="d${d}"]`).check();
    await press(client, '[data-testid="habit-add-own"]', async () => (await client.locator('[data-testid="habit"][data-name="Evening walk"]').count()) > 0, "the member's own habit added");
    const habits = await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) });
    const walkHabit = habits.find((h) => h.name === "Evening walk")!;
    const breath = habits.find((h) => h.name === "Breathwork")!;
    const med = habits.find((h) => h.name === "Meditation")!;
    if (habits.length !== 3 || walkHabit.kind !== "count" || walkHabit.target !== 6000 || walkHabit.unit !== "steps" || JSON.stringify(walkHabit.days) !== "[1,2,3,4,5]" || med.kind !== "minutes" || med.target !== 10) throw new Error("the habits land as typed: kind, target, unit and days");
    // Three days kept before yesterday, yesterday missed: the streak forgives the one miss and counts four with today.
    await db.insert(schema.bodyHabitLogs).values([2, 3, 4].map((n) => ({ id: freshId(), workspaceId: mem.workspaceId, userId: maya.id, habitId: breath.id, date: addDays(today, -n), value: 1, source: "manual" as const })));
    await client.goto(`${base}/body/practices`);
    await client.locator('[data-testid="habit"][data-name="Breathwork"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="habit"][data-name="Breathwork"] [data-testid="habit-tap"]', async () => (await client.locator('[data-testid="habit"][data-name="Breathwork"]').getAttribute("data-kept")) === "1", "Breathwork kept");
    const logsNow = await db.query.bodyHabitLogs.findMany({ where: mine(schema.bodyHabitLogs) });
    const wantStreak = streakOf(breath, logsNow, today, { addDays, weekday, startOfWeek });
    if (wantStreak !== 4 || (await client.locator('[data-testid="habit"][data-name="Breathwork"]').getAttribute("data-streak")) !== "4") throw new Error(`the streak forgives yesterday and counts the three days before plus today: engine ${wantStreak}, page ${await client.locator('[data-testid="habit"][data-name="Breathwork"]').getAttribute("data-streak")}`);
    await fillExact(client, '[data-testid="habit"][data-name="Meditation"] [data-testid="habit-value"]', "12");
    await press(client, '[data-testid="habit"][data-name="Meditation"] [data-testid="habit-log"]', async () => (await client.locator('[data-testid="habit"][data-name="Meditation"]').getAttribute("data-kept")) === "1", "Meditation 12 min");
    const dueToday = [1, 2, 3, 4, 5].includes(weekday(today)) ? 3 : 2;
    const sum = client.locator('[data-testid="practices-summary"]');
    if ((await sum.getAttribute("data-kept")) !== "2" || (await sum.getAttribute("data-due")) !== String(dueToday)) throw new Error(`2 of ${dueToday} kept today: ${await sum.getAttribute("data-kept")} of ${await sum.getAttribute("data-due")}`);
    if ((await client.locator('[data-testid="habit"][data-name="Breathwork"] [data-testid="habit-dots"]').getAttribute("data-kept")) === "0") throw new Error("the week's dots show the kept days");
    await noSideScroll(client, "/body/practices");
    // Today: the chips, one tap off and on again, back on Today each time.
    await client.goto(`${base}/today`);
    await client.locator('[data-testid="today-habits"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="today-habit"][data-name="Breathwork"]').getAttribute("data-kept")) !== "1" || (await client.locator('[data-testid="today-habit"]').count()) !== dueToday) throw new Error("Today's chips are the habits due today, Breathwork kept");
    await press(client, '[data-testid="today-habit"][data-name="Breathwork"]', async () => (await client.locator('[data-testid="today-habit"][data-name="Breathwork"]').getAttribute("data-kept")) === "0", "the chip untapped");
    // Untapped, the run carried from before shows a grey flame that says "not yet today", never as done today (Danno, rev 364).
    if ((await client.locator('[data-testid="today-habit"][data-name="Breathwork"] [data-testid="today-streak"]').getAttribute("data-kept")) !== "0") throw new Error("an unkept habit's streak badge is marked not yet today");
    await press(client, '[data-testid="today-habit"][data-name="Breathwork"]', async () => (await client.locator('[data-testid="today-habit"][data-name="Breathwork"]').getAttribute("data-kept")) === "1", "the chip tapped again");
    if ((await client.locator('[data-testid="today-habit"][data-name="Breathwork"] [data-testid="today-streak"]').getAttribute("data-kept")) !== "1") throw new Error("a kept habit's streak badge is marked kept");
    if (!/\/today/.test(client.url())) throw new Error("the chip comes back to Today");
    // Archived habits (Claude → Body, rev 386): a starter added and kept once, archived; the fold lists it with its day; Restore brings it back
    // whole; archived again, Delete asks with the count and removes the habit and its log. Nothing active offers Delete.
    await client.goto(`${base}/body/practices`);
    await client.locator('[data-testid="habit-starter"][data-name="Stretching"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="habit-starter"][data-name="Stretching"]', async () => (await client.locator('[data-testid="habit"][data-name="Stretching"]').count()) > 0, "Stretching added");
    await press(client, '[data-testid="habit"][data-name="Stretching"] [data-testid="habit-tap"]', async () => (await client.locator('[data-testid="habit"][data-name="Stretching"]').getAttribute("data-kept")) === "1", "Stretching kept once");
    const stretch = (await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) })).find((h) => h.name === "Stretching")!;
    if (await client.locator('[data-testid="habit-delete"]').count()) throw new Error("no Delete on an active habit");
    if (await client.locator('[data-testid="habits-archived"]').count()) throw new Error("no archived fold while nothing is archived");
    await client.locator("summary", { hasText: "Stretching" }).click();
    await press(client, `form:has(input[name="id"][value="${stretch.id}"]) [data-testid="habit-archive"]`, async () => (await client.locator('[data-testid="habit"][data-name="Stretching"]').count()) === 0 && (await client.locator('[data-testid="habits-archived"]').count()) > 0, "Stretching archived");
    const archivedRow = client.locator('[data-testid="habit-archived"][data-name="Stretching"]');
    if ((await client.locator('[data-testid="habits-archived"] > summary').textContent())?.trim() !== "Archived (1)" || (await archivedRow.getAttribute("data-logged")) !== "1" || !(await archivedRow.textContent())?.includes("1 logged day")) throw new Error("the fold lists the archived habit with its one logged day");
    await client.locator('[data-testid="habits-archived"] > summary').click();
    await press(client, '[data-testid="habit-archived"][data-name="Stretching"] [data-testid="habit-restore"]', async () => (await client.locator('[data-testid="habit"][data-name="Stretching"]').count()) > 0 && (await client.locator('[data-testid="habits-archived"]').count()) === 0, "Stretching restored");
    if ((await client.locator('[data-testid="habit"][data-name="Stretching"]').getAttribute("data-kept")) !== "1" || (await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, stretch.id) })).length !== 1) throw new Error("a restored habit keeps its log and its kept mark");
    await client.locator("summary", { hasText: "Stretching" }).click();
    await press(client, `form:has(input[name="id"][value="${stretch.id}"]) [data-testid="habit-archive"]`, async () => (await client.locator('[data-testid="habits-archived"]').count()) > 0, "Stretching archived again");
    await client.locator('[data-testid="habits-archived"] > summary').click();
    await client.locator('[data-testid="habit-archived"][data-name="Stretching"] [data-testid="habit-delete"]').click();
    if ((await client.locator('dialog[open] [data-testid="confirm-delete-question"]').textContent())?.trim() !== 'Delete "Stretching" and its 1 logged day?') throw new Error(`the confirm counts the logged days: "${await client.locator('dialog[open] [data-testid="confirm-delete-question"]').textContent()}"`);
    await press(client, 'dialog[open] [data-testid="confirm-delete-yes"]', async () => (await client.locator('[data-testid="habits-archived"]').count()) === 0 && (await client.locator('[data-testid="habit"][data-name="Stretching"]').count()) === 0, "Stretching deleted");
    if ((await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) })).some((h) => h.id === stretch.id) || (await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, stretch.id) })).length) throw new Error("Delete removes the habit and every log for good");
    console.log("✓ archived habits: the fold lists an archived habit with its logged day, Restore brings it back whole, Delete asks with the count and removes it and its log; Delete is offered only there");
    // Metric or US with habit difficulty (Danno, rev 424; Joy, rev 431): the walk's member is in Los Angeles, so US first; switched to
    // metric on Settings, water shows in litres and takes millilitres while the stored rows keep their own unit; back to US, nothing moved.
    const settingsUs = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!;
    if (settingsUs.measures !== "us" || settingsUs.weightUnit !== "lb") throw new Error(`a member in a US time zone reads as US: ${settingsUs.measures} ${settingsUs.weightUnit}`);
    const waterId = freshId();
    await db.insert(schema.bodyHabits).values({ id: waterId, workspaceId: mem.workspaceId, userId: maya.id, name: "Water", kind: "amount", unit: "oz", target: 130, days: [], order: 50 });
    await db.update(schema.bodyHabits).set({ difficulty: "hard" }).where(and(mine(schema.bodyHabits), eq(schema.bodyHabits.name, "Breathwork")));
    await client.goto(`${base}/body/settings`);
    await client.locator('[data-testid="body-measures"]').selectOption("metric");
    await press(client, '[data-testid="body-settings-save"]', async () => (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))?.measures === "metric", "metric saved");
    const settingsMetric = (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))!;
    if (settingsMetric.weightUnit !== "kg" || settingsMetric.foodUnit !== "g") throw new Error("the weight and food units follow metric");
    await client.goto(`${base}/body/practices`);
    const waterRow = client.locator('[data-testid="habit"][data-name="Water"]');
    await waterRow.waitFor({ timeout: 30000 });
    if (!(await waterRow.innerText()).includes("3.8 L a day")) throw new Error(`Water's 130 oz target reads in litres: ${await waterRow.innerText()}`);
    if ((await client.locator('[data-testid="habit"][data-name="Breathwork"] [data-testid="habit-difficulty-mark"]').getAttribute("data-difficulty")) !== "hard") throw new Error("a hard habit carries its mark on Practices");
    await fillExact(client, '[data-testid="habit"][data-name="Water"] [data-testid="habit-value"]', "0.5");
    await press(client, '[data-testid="habit"][data-name="Water"] [data-testid="habit-log"]', async () => (await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, waterId) })).length === 1, "half a litre of water");
    const waterLog = (await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, waterId) }))[0];
    if (waterLog.value !== 16.91) throw new Error(`0.5 L typed is stored in the habit's own oz: ${waterLog.value}`);
    await client.goto(`${base}/body/weight`);
    if (!(await client.locator('[data-testid="trend-weight-stats"]').innerText()).includes(" kg")) throw new Error("weigh-ins read in kg once metric");
    await client.goto(`${base}/today`);
    if (!(await client.locator('[data-testid="today-habit"][data-name="Breathwork"] [data-testid="today-difficulty"]').count())) throw new Error("the Today chip carries the difficulty mark");
    await client.goto(`${base}/body/settings`);
    await client.locator('[data-testid="body-measures"]').selectOption("us");
    await press(client, '[data-testid="body-settings-save"]', async () => (await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) }))?.measures === "us", "back to US");
    await client.goto(`${base}/body/practices`);
    await waterRow.waitFor({ timeout: 30000 });
    if (!(await waterRow.innerText()).includes("130 oz a day") || (await db.query.bodyHabitLogs.findMany({ where: eq(schema.bodyHabitLogs.habitId, waterId) }))[0].value !== 16.91) throw new Error("back in US, Water reads 130 oz and the stored log never moved");
    await db.delete(schema.bodyHabitLogs).where(eq(schema.bodyHabitLogs.habitId, waterId));
    await db.delete(schema.bodyHabits).where(eq(schema.bodyHabits.id, waterId));
    await db.update(schema.bodyHabits).set({ difficulty: null }).where(and(mine(schema.bodyHabits), eq(schema.bodyHabits.name, "Breathwork")));
    console.log("✓ measures: Los Angeles starts US; metric shows Water's 130 oz as 3.8 L, 0.5 L typed stores as 16.91 oz, weigh-ins in kg; back to US nothing moved; a hard habit marked on Practices and Today");
    // Supplements, vitamins and prescriptions (rev 424; Joy and Tom, rev 431): a script added through the form with its expiry from
    // 12 months, a dose taken on the page and on Today, Tom's pill boxes, a count, a refill, then the script expired and the refill refused.
    await client.goto(`${base}/body/practices`);
    await client.locator('[data-testid="meds-link"]').click();
    await client.waitForURL(/\/body\/practices\/meds/);
    const medForm = client.locator('[data-testid="med-new-form"]');
    await fillExact(client, '[data-testid="med-new-form"] input[name="name"]', "Metformin");
    await medForm.locator('select[name="type"]').selectOption("prescription");
    await fillExact(client, '[data-testid="med-new-form"] input[name="timesPerDay"]', "2");
    await fillExact(client, '[data-testid="med-new-form"] input[name="onHand"]', "60");
    await fillExact(client, '[data-testid="med-new-form"] input[name="supplyDays"]', "30");
    await medForm.locator('input[name="lastFilledOn"]').fill(today);
    await medForm.locator('input[name="issuedOn"]').fill(today);
    await medForm.locator('select[name="expiryMonths"]').selectOption("12");
    await fillExact(client, '[data-testid="med-new-form"] input[name="repeatsLeft"]', "3");
    await press(client, '[data-testid="med-add"]', async () => (await client.locator('[data-testid="med"][data-name="Metformin"]').count()) > 0, "Metformin added");
    const met = (await db.query.bodyMeds.findMany({ where: mine(schema.bodyMeds) })).find((m) => m.name === "Metformin")!;
    const { expiryFrom: expiryOf } = await import("@/lib/engine/body-meds");
    if (met.type !== "prescription" || met.timesPerDay !== 2 || met.onHand !== 60 || met.repeatsLeft !== 3 || met.expiresOn !== expiryOf(today, 12) || met.refillDays !== 12) throw new Error(`the script saved as typed, expiring 12 months from issue: ${JSON.stringify(met)}`);
    if (!(await client.locator('[data-testid="med"][data-name="Metformin"] [data-testid="med-lines"]').innerText()).includes("Refill opens 12 days before you run out")) throw new Error("the refill window reads in Tom's words");
    await press(client, '[data-testid="med-today"][data-name="Metformin"] [data-testid="med-take"][data-slot="1"]', async () => (await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))?.onHand === 59, "dose 1 taken");
    await client.goto(`${base}/today`);
    const medChips = client.locator('[data-testid="today-med"][data-name="Metformin"]');
    if ((await medChips.count()) !== 2 || (await medChips.first().getAttribute("data-taken")) !== "1") throw new Error("Today carries a Take chip per dose, the first taken");
    await client.goto(`${base}/body/practices/meds`);
    await press(client, '[data-testid="med"][data-name="Metformin"] [data-testid="med-boxes"]', async () => (await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))?.boxedUntil === addDays(today, 13), "14 days of pill boxes");
    const boxed = (await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))!;
    if (boxed.onHand !== 31 || !(await client.locator('[data-testid="med-said"]').innerText()).includes("bottle 59 → 31")) throw new Error(`28 doses leave the bottle for the boxes and the page says so: ${boxed.onHand}`);
    await fillExact(client, '[data-testid="med"][data-name="Metformin"] [data-testid="med-count-value"]', "40");
    await press(client, '[data-testid="med"][data-name="Metformin"] [data-testid="med-count"]', async () => (await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))?.onHand === 40, "counted 40");
    await press(client, '[data-testid="med"][data-name="Metformin"] [data-testid="med-refill"]', async () => (await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))?.repeatsLeft === 2, "refilled");
    if ((await db.query.bodyMeds.findFirst({ where: eq(schema.bodyMeds.id, met.id) }))?.onHand !== 100) throw new Error("a refill adds a fill's supply (30 days at 2 a day)");
    await db.update(schema.bodyMeds).set({ expiresOn: addDays(today, -1) }).where(eq(schema.bodyMeds.id, met.id));
    await client.goto(`${base}/body/practices/meds`);
    if (!(await client.locator('[data-testid="med"][data-name="Metformin"] [data-tone="stop"]').innerText()).includes("2 repeats left can't be used. Ask for a new script.")) throw new Error("an expired script says its repeats can't be used");
    await press(client, '[data-testid="med"][data-name="Metformin"] [data-testid="med-refill"]', async () => (await client.locator('[data-testid="body-error"]').count()) > 0, "refill refused");
    if (!(await client.locator('[data-testid="body-error"]').innerText()).includes("a refill needs a new script")) throw new Error("an expired script refuses a refill in words");
    await client.goto(`${base}/today`);
    if (!(await client.locator('[data-testid="today-med-line"]').first().innerText()).includes("Metformin: Script expired")) throw new Error("Today carries the line that needs doing");
    // Private: no coach sees it and no AI reads it until the member's own switches say so.
    const { coachMeds: coachMedsOf } = await import("@/lib/queries/body");
    const coachUserM = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachMemM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachUserM.id), eq(schema.memberships.workspaceId, mem.workspaceId)) }))!;
    const coachWsM = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) }))!;
    const asCoachM = { user: coachUserM, workspace: coachWsM, membership: coachMemM, role: "coach" as const, tz: coachWsM.timezone, today, hour: 12, actor: coachUserM, switchedInto: null };
    if ((await coachMedsOf(asCoachM, maya.id, today)) !== null) throw new Error("the coach reads no meds while the member's switch is off");
    const { allTools: allToolsM } = await import("@/lib/mcp/registry");
    await import("@/lib/mcp/tools/index");
    const medsTool = allToolsM().find((t) => t.name === "body_meds")!;
    const refusedMeds = await medsTool.handler({ ...asCoachM, user: maya, membership: mem, role: "client" as const, actor: maya }, {}).then(() => "read", (e: Error) => e.message);
    if (!/switch/i.test(refusedMeds)) throw new Error(`no AI reads the meds without the switches: ${refusedMeds}`);
    console.log("✓ supplements & meds: a script added with its 12-month expiry; a dose taken on the page and shown on Today; 14 days of pill boxes 59 → 31; counted 40; refilled to 100 with 2 repeats left; expired, it says so and refuses a refill; private to coach and AI");
    // Sleep: last night, then an earlier night, then last night logged again replaces it.
    await client.goto(`${base}/body/sleep`);
    await client.locator('[data-testid="sleep-form"]').waitFor({ timeout: 30000 });
    await fillExact(client, '[data-testid="sleep-hours"]', "7:30");
    await fillExact(client, '[data-testid="sleep-score"]', "82");
    await press(client, '[data-testid="sleep-save"]', async () => (await client.locator('[data-testid="sleep-stats"]').getAttribute("data-last")) === "7.5", "last night 7 h 30 min");
    await client.locator('[data-testid="sleep-date"]').fill(yesterday);
    await fillExact(client, '[data-testid="sleep-hours"]', "6");
    await press(client, '[data-testid="sleep-save"]', async () => (await client.locator('[data-testid="sleep-night"]').count()) === 2, "two nights");
    const sw = sleepWeek([{ date: today, hours: 7.5 }, { date: yesterday, hours: 6 }].filter((n) => n.date >= startOfWeek(today)));
    const st = client.locator('[data-testid="sleep-stats"]');
    if ((await st.getAttribute("data-avg")) !== String(sw.avg) || (await st.getAttribute("data-nights")) !== String(sw.nights) || (await st.getAttribute("data-floor")) !== String(sw.atFloor)) throw new Error(`the week's sleep tiles are the engine's (${JSON.stringify(sw)})`);
    await client.locator('[data-testid="sleep-date"]').fill(today);
    await fillExact(client, '[data-testid="sleep-hours"]', "8");
    await press(client, '[data-testid="sleep-save"]', async () => (await client.locator('[data-testid="sleep-stats"]').getAttribute("data-last")) === "8", "last night replaced");
    const sleepRows = await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.date, today), inArray(schema.bodyDaily.key, ["sleep_h", "sleep_score"])) });
    if (sleepRows.length !== 1 || sleepRows[0].value !== 8) throw new Error("a night logged again replaces its rows (the score went with it)");
    await noSideScroll(client, "/body/sleep");
    // The health log: an injury restricting Bench press, marked on Training; resolved, the mark lifts; reopened for the checks below.
    const bench = (await db.query.bodyExercises.findMany({ where: mine(schema.bodyExercises) })).find((e) => e.name === "Bench press")!;
    const injury = "Left shoulder, sharp overhead";
    await client.goto(`${base}/body/training/health`);
    await client.locator('[data-testid="health-form"]').waitFor({ timeout: 30000 });
    if (!(await client.locator('[data-testid="health-none"]').count())) throw new Error("the health log starts empty");
    await fillExact(client, '[data-testid="health-title"]', injury);
    await client.locator('[data-testid="health-form"] select[name="side"]').selectOption("left");
    await client.locator(`[data-testid="health-form"] input[name="restricted"][value="${bench.id}"]`).check();
    await press(client, '[data-testid="health-add"]', async () => (await client.locator('[data-testid="health-entry"][data-open="1"]').count()) === 1, "the entry added");
    if (!((await client.locator('[data-testid="health-restricted"]').textContent()) ?? "").includes("Bench press")) throw new Error("the entry names the exercise it leaves out");
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-health-link"]').waitFor({ timeout: 30000 });
    const benchCard = client.locator('[data-testid="training-exercise"][data-name="Bench press"]');
    if ((await benchCard.count()) ? (await benchCard.getAttribute("data-restricted")) !== "1" || !((await client.locator('[data-testid="training-restricted"]').textContent()) ?? "").includes(injury) : !(await client.locator('option', { hasText: "⚠ Bench press" }).count())) throw new Error("Training marks the restricted exercise while the injury is open");
    await client.goto(`${base}/body/training/health`);
    await client.locator('[data-testid="health-resolve"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="health-resolve"]', async () => (await client.locator('[data-testid="health-entry"][data-open="0"]').count()) === 1, "resolved");
    await client.goto(`${base}/body/training`);
    await client.locator('[data-testid="training-health-link"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="training-restricted"]').count()) || (await client.locator("option", { hasText: "⚠" }).count())) throw new Error("a resolved injury lifts its mark");
    await client.goto(`${base}/body/training/health`);
    await client.locator('[data-testid="health-reopen"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="health-reopen"]', async () => (await client.locator('[data-testid="health-entry"][data-open="1"]').count()) === 1, "reopened");
    await noSideScroll(client, "/body/training/health");
    // The week's tiles carry the query's own habit tally and the engine's sleep average.
    const hdq = await habitsDay(mem.workspaceId, maya.id, today, today);
    await client.goto(`${base}/body/week`);
    await client.locator('[data-testid="week-recovery"]').waitFor({ timeout: 30000 });
    const wr = client.locator('[data-testid="week-recovery"]');
    const sw2 = sleepWeek([{ date: today, hours: 8 }, { date: yesterday, hours: 6 }].filter((n) => n.date >= startOfWeek(today)));
    if ((await wr.getAttribute("data-habits-kept")) !== String(hdq.week.kept) || (await wr.getAttribute("data-habits-due")) !== String(hdq.week.due) || hdq.week.kept < 2 || (await wr.getAttribute("data-sleep-avg")) !== String(sw2.avg)) throw new Error(`the week's recovery tiles are the query's: habits ${hdq.week.kept} of ${hdq.week.due}, sleep ${sw2.avg}`);
    console.log(`✓ phase 8: two starters and an own habit added as typed; Breathwork's streak forgives yesterday (${wantStreak}); Meditation at 12 min kept; 2 of ${dueToday} today; Today's chips toggle and come back; sleep 7:30 with a score, an earlier 6 h, then 8 h replacing last night; the health log restricts Bench press on Training until resolved; the week's tiles carry habits and sleep`);

    // ── Phase 9: the correlation explorer. Thirty nights of sleep and thirty daily logs seeded so that calls booked the next day
    // track sleep; the page's readout is the engine's own r and n; a pair with too few days says so; the Claude tool answers alike. ──
    const { pairUp, verdict: verdictOf } = await import("@/lib/engine/body-correlate");
    const { startOfWeek: mondayOf } = await import("@/lib/dates");
    const seededSleep: { date: string; value: number }[] = [];
    const seededCalls: { date: string; value: number }[] = [];
    for (let back = 33; back >= 3; back--) {
      const d = addDays(today, -back);
      const hours = 6 + ((back * 7) % 5) * 0.5; // 6 to 8 h, no pattern with the date
      seededSleep.push({ date: d, value: hours });
      seededCalls.push({ date: addDays(d, 1), value: Math.round((hours - 6) * 2) + (back % 2) }); // more calls the day after a longer night
    }
    await db.insert(schema.bodyDaily).values(seededSleep.map((n) => ({ id: freshId(), workspaceId: mem.workspaceId, userId: maya.id, date: n.date, key: "sleep_h", value: n.value, source: "manual" as const, readingId: `sleep:${n.date}`, time: null })));
    for (const c of seededCalls) {
      const have = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, c.date)) });
      if (have) await db.update(schema.dailyLogs).set({ callsBooked: c.value }).where(eq(schema.dailyLogs.id, have.id));
      else await db.insert(schema.dailyLogs).values({ id: freshId(), workspaceId: mem.workspaceId, userId: maya.id, date: c.date, callsBooked: c.value });
    }
    const windowFrom = addDays(mondayOf(today), -7 * 7);
    const allSleep = (await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.key, "sleep_h"), gte(schema.bodyDaily.date, addDays(windowFrom, -1))) })).map((r) => ({ date: r.date, value: r.value }));
    const allCalls = (await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, maya.id), gte(schema.dailyLogs.date, windowFrom)) })).map((l) => ({ date: l.date, value: l.callsBooked }));
    const expectedPairs = pairUp(allSleep, allCalls, { lag: 1, grain: "daily", foldA: "mean", foldB: "sum", addDays, startOfWeek: mondayOf });
    const expectedVerdict = verdictOf(expectedPairs, "Sleep hours", "Calls booked", "days");
    if (expectedVerdict.kind !== "steady" || expectedVerdict.n < 21) throw new Error(`the seed gives a steady early signal: ${expectedVerdict.words}`);
    await client.goto(`${base}/body/week`);
    await client.locator('[data-testid="week-insights-link"]').click();
    await client.waitForURL(/\/body\/insights/);
    await client.locator('[data-testid="insights-verdict"]').waitFor({ timeout: 30000 });
    const vd = client.locator('[data-testid="insights-verdict"]');
    if ((await vd.getAttribute("data-kind")) !== "steady" || (await vd.getAttribute("data-r")) !== String(expectedVerdict.r) || (await vd.getAttribute("data-n")) !== String(expectedVerdict.n) || !((await vd.textContent()) ?? "").includes("moved together")) throw new Error(`the first preset's readout is the engine's (${expectedVerdict.words}): ${await vd.textContent()}`);
    if (/caus(ed|es|ing)\b/i.test((await client.locator("main").textContent()) ?? "")) throw new Error("the page never says caused");
    if ((await client.locator('[data-testid="pair-scatter"]').getAttribute("data-n")) !== String(expectedVerdict.n) || !(await client.locator('[data-testid="pair-timeline"]').count())) throw new Error("the scatter holds every pair and the timeline draws both");
    await noSideScroll(client, "/body/insights");
    // Rev 237 phase 15: a day marked travelling joins the days Patterns leaves out when asked.
    {
      const { correlate: correlateQ } = await import("@/lib/queries/body");
      const corrArgs = { a: "sleep_h", b: "callsBooked", lag: 1, window: 8, grain: "daily" as const, excludeFlagged: true };
      const excludedBefore = (await correlateQ(mem.workspaceId, maya.id, today, mem.timezone || "UTC", corrArgs))!.excluded;
      await client.goto(`${base}/body?date=${yesterday}`);
      const openFlagFold = async () => {
        const fold = client.locator('details:has([data-testid="body-day-flag-form"]) > summary');
        await fold.waitFor({ timeout: 30000 });
        if (!(await fold.evaluate((el) => (el.parentElement as HTMLDetailsElement).open))) await fold.click();
        await client.locator('[data-testid="body-day-flag-form"] select[name="flag"]').waitFor({ timeout: 30000 });
      };
      await openFlagFold();
      await client.locator('[data-testid="body-day-flag-form"] select[name="flag"]').selectOption("travel");
      await press(client, '[data-testid="body-day-flag-save"]', async () => (await client.locator('[data-testid="body-day-flag"]').count()) > 0, "the day marked");
      if (!(await client.locator('[data-testid="body-day-flag"]').innerText()).includes("Travelling")) throw new Error("the marked day says Travelling");
      if ((await db.query.bodyDays.findFirst({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.date, yesterday)) }))?.flag !== "travel") throw new Error("the mark is on the day's row");
      const excludedAfter = (await correlateQ(mem.workspaceId, maya.id, today, mem.timezone || "UTC", corrArgs))!.excluded;
      if (excludedAfter < excludedBefore + 1) throw new Error(`a marked day leaves Patterns when asked: ${excludedBefore} before, ${excludedAfter} after`);
      await client.goto(`${base}/body/week`);
      await client.locator('[data-testid="week-day-flag"]').first().waitFor({ timeout: 30000 });
      await client.goto(`${base}/body?date=${yesterday}`);
      await openFlagFold();
      await client.locator('[data-testid="body-day-flag-form"] select[name="flag"]').selectOption("");
      await press(client, '[data-testid="body-day-flag-save"]', async () => (await client.locator('[data-testid="body-day-flag"]').count()) === 0, "the mark cleared");
      console.log(`✓ day flags: yesterday marked Travelling shows on Log and the week, leaves Patterns when asked (${excludedBefore} → ${excludedAfter} days left out), and clears again`);
    }
    // A pair with too few days: the readout says so, hides r, and shows no scatter.
    await client.goto(`${base}/body/insights?a=sleep_score&b=posts&lag=0&window=4&grain=daily`);
    await client.locator('[data-testid="insights-verdict"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="insights-verdict"]').getAttribute("data-kind")) !== "none" || (await client.locator('[data-testid="pair-scatter"]').count()) || !((await client.locator('[data-testid="insights-verdict"]').textContent()) ?? "").includes("Not enough data yet")) throw new Error("under 21 pairs: not enough data yet, no r, no scatter");
    // Weight defaults to weekly grain (rev 231).
    await client.goto(`${base}/body/insights?a=weight&b=cal`);
    await client.locator('[data-testid="insights-grain"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="insights-grain"]').inputValue()) !== "weekly") throw new Error("weight reads weekly unless asked otherwise");
    console.log(`✓ patterns: sleep → calls booked the next day reads as the engine's ${expectedVerdict.words}; too few pairs say so; weight defaults to weekly; never a cause`);

    // ── Longer views (phase 10b): the week page over a month and 90 days against the range query's own numbers; Sleep and
    // Practices over the range; an exercise's history over a year. ──
    const { bodyRange: rangeOf, sleepRange: sleepOver, habitsRange: habitsOver } = await import("@/lib/queries/body");
    const { rangeBounds: boundsOf } = await import("@/lib/engine/body-range");
    const b90 = boundsOf("90d", null, today, { addDays, startOfWeek: mondayOf });
    const rq = (await rangeOf(mem.workspaceId, maya.id, b90, today))!;
    await client.goto(`${base}/body/week`);
    await client.locator('[data-testid="range-90d"]').click();
    await client.waitForURL(/range=90d/);
    await client.locator('[data-testid="range-training"]').waitFor({ timeout: 30000 });
    const rt = client.locator('[data-testid="range-training"]');
    if ((await rt.getAttribute("data-sessions")) !== String(rq.training.sessions) || (await rt.getAttribute("data-sets")) !== String(rq.training.sets) || (await rt.getAttribute("data-prs")) !== String(rq.training.prs) || rq.training.sessions < 2) throw new Error(`the 90-day training tiles are the query's (${rq.training.sessions} sessions, ${rq.training.sets} sets, ${rq.training.prs} PRs)`);
    const rr = client.locator('[data-testid="range-rest"]');
    if ((await rr.getAttribute("data-sleep-nights")) !== String(rq.sleep.summary.nights) || (await rr.getAttribute("data-habits-kept")) !== String(rq.habits.kept) || (await rr.getAttribute("data-habits-due")) !== String(rq.habits.due) || (await rr.getAttribute("data-weigh-days")) !== String(rq.weigh.days)) throw new Error("the 90-day weight, sleep and habit tiles are the query's");
    if (!((await client.locator('[data-testid="range-routines"]').textContent()) ?? "").includes(ROUTINE.name)) throw new Error("the routines that ran are named with their count");
    if ((await client.locator('[data-testid="range-picker"]').getAttribute("data-from")) !== b90.from) throw new Error("the picker carries the range's bounds");
    await noSideScroll(client, "/body/week?range=90d");
    // Month: the page steps back a month and names it.
    await client.locator('[data-testid="range-month"]').click();
    await client.waitForURL(/range=month/);
    await client.locator('[data-testid="range-label"]').waitFor({ timeout: 30000 });
    await client.locator('a[aria-label="Earlier"]').click();
    await client.waitForURL(/from=/);
    await client.locator('[data-testid="range-label"]').waitFor({ timeout: 30000 });
    const prevMonth = boundsOf("month", addDays(`${today.slice(0, 7)}-01`, -1), today, { addDays, startOfWeek: mondayOf });
    if ((await client.locator('[data-testid="range-label"]').textContent()) !== prevMonth.label) throw new Error(`stepping back names last month (${prevMonth.label}): ${await client.locator('[data-testid="range-label"]').textContent()}`);
    // Sleep over 90 days: the nights seeded above, as the engine counts them.
    const sr = await sleepOver(mem.workspaceId, maya.id, b90);
    await client.goto(`${base}/body/sleep?range=90d`);
    await client.locator('[data-testid="sleep-range"]').waitFor({ timeout: 30000 });
    const sl = client.locator('[data-testid="sleep-range"]');
    if ((await sl.getAttribute("data-nights")) !== String(sr.summary.nights) || (await sl.getAttribute("data-avg")) !== String(sr.summary.avg) || (await sl.getAttribute("data-under")) !== String(sr.under) || sr.summary.nights < 30) throw new Error(`Sleep over 90 days is the query's: ${sr.summary.nights} nights, ${sr.summary.avg} a night, ${sr.under} under`);
    // Practices over the month: kept of due per habit, with Breathwork's best run of four or more.
    const bm = boundsOf("month", null, today, { addDays, startOfWeek: mondayOf });
    const hr = await habitsOver(mem.workspaceId, maya.id, bm, today);
    await client.goto(`${base}/body/practices?range=month`);
    await client.locator('[data-testid="habits-range"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="habits-range"]').getAttribute("data-kept")) !== String(hr.kept) || (await client.locator('[data-testid="habits-range"]').getAttribute("data-due")) !== String(hr.due)) throw new Error("Practices over the month carries the query's kept of due");
    const bh = hr.habits.find((h) => h.name === "Breathwork")!;
    if ((await client.locator('[data-testid="habit-range"][data-name="Breathwork"]').getAttribute("data-best")) !== String(bh.best)) throw new Error(`Breathwork's best run is the query's (${bh.best})`);
    // The strip draws whole weeks: every cell up to today has its day's title, the month's first Monday included (Danno, rev 364).
    const untitled = await client.locator('[data-testid="habit-range"][data-name="Breathwork"] [data-date]').evaluateAll((els, t) => els.filter((e) => (e.getAttribute("data-date") ?? "") <= t && !e.getAttribute("title")).length, today);
    if (untitled !== 0 || (await client.locator('[data-testid="habit-range"][data-name="Breathwork"] [data-date]').count()) % 7 !== 0) throw new Error("the month strip draws whole weeks, every past day titled");
    if ((await client.locator('[data-testid="habit-range"][data-name="Breathwork"] [data-pending="1"]').count()) !== 0) throw new Error("a kept habit has no pending outline today");
    // Evening walk is due Monday to Friday and never logged: on a weekday, today is an outline, not a fill.
    if ([1, 2, 3, 4, 5].includes(weekday(today)) && (await client.locator(`[data-testid="habit-range"][data-name="Evening walk"] [data-date="${today}"][data-pending="1"]`).count()) !== 1) throw new Error("today, due, not yet is an outline on the strip");
    if ((await client.locator('[data-testid="habit-range"][data-name="Breathwork"]').textContent())?.includes("Th") !== true) throw new Error("the strip's day labels say Th");
    await noSideScroll(client, "/body/practices?range=month");
    // An exercise over a year: every session in the list, the span marked.
    await client.goto(`${base}/body/training/${bench.id}?range=365`);
    await client.locator('[data-testid="exercise-range"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="exercise-range"]').getAttribute("data-range")) !== "365" || Number(await client.locator('[data-testid="exercise-range"]').getAttribute("data-sessions")) < 2) throw new Error("the exercise's history reads over a year");
    console.log(`✓ longer views: 90 days on the week page carries the query's ${rq.training.sessions} sessions, ${rq.training.sets} sets and ${rq.training.prs} PRs, ${rq.sleep.summary.nights} nights and ${rq.habits.kept} of ${rq.habits.due} habits kept; a month steps back to ${prevMonth.label}; Sleep and Practices read over the range; the exercise over a year`);

    // ── WHOOP (phase 11): connect through the mock's OAuth, the pull lands nights, recovery, strain and workouts as the engine maps
    // them, a sauna workout ticks the Sauna habit, Training shows the day's activities, a signed webhook is handled and a bad one
    // refused, Sync now, then Disconnect removes the row and keeps what was pulled. ──
    const { sleepRows: nightRowsOf, activityRow: activityOf } = await import("@/lib/engine/body-whoop");
    const { todayInTz: dateInTz } = await import("@/lib/dates");
    // A connection to the mock's WHOOP id left by an earlier run that stopped part way would answer this run's webhooks too.
    await db.delete(schema.bodyDevices).where(eq(schema.bodyDevices.providerUserId, "4242"));
    const whoopMock = spawnMock("npx", ["tsx", "scripts/mock-whoop.ts", "4072"], { stdio: "ignore", detached: true });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          await fetch("http://localhost:4072/__calls");
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      const memberTz = mem.timezone || (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) }))!.timezone;
      const whoopRecords = (await (await fetch("http://localhost:4072/__records")).json()) as { sleep: Parameters<typeof nightRowsOf>[0][]; workout: Parameters<typeof activityOf>[0][]; cycle: { id: number; start: string }[] };
      const inTz = (iso: string) => dateInTz(memberTz, new Date(iso));
      const sauna = (await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) })).find((h) => h.name === "Sauna") ?? null;
      if (!sauna) await db.insert(schema.bodyHabits).values({ id: freshId(), workspaceId: mem.workspaceId, userId: maya.id, name: "Sauna", kind: "minutes", target: 15, days: [], order: 9 });
      const saunaHabit = (await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) })).find((h) => h.name === "Sauna")!;
      await client.goto(`${base}/body/settings`);
      await client.locator('[data-testid="whoop-connect"]').waitFor({ timeout: 30000 });
      await client.locator('[data-testid="whoop-connect"]').click();
      await client.waitForURL(/whoop=connected/, { timeout: 30000 });
      await client.locator('[data-testid="whoop-connected"]').waitFor({ timeout: 30000 });
      if ((await client.locator('[data-testid="whoop-connected"]').getAttribute("data-known")) !== "1") throw new Error("the member's WHOOP id is read on connect");
      const device = (await db.query.bodyDevices.findMany({ where: mine(schema.bodyDevices) }))[0];
      if (!device || !device.accessToken?.startsWith("enc:v1:") || !device.refreshToken?.startsWith("enc:v1:") || device.providerUserId !== "4242" || !device.lastSyncAt) throw new Error("the device row holds sealed tokens, the WHOOP id and the first sync");
      const whoopRows = await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.source, "whoop")) });
      const night1 = nightRowsOf(whoopRecords.sleep[0], inTz, () => null);
      const hoursRow = whoopRows.find((r) => r.readingId === "whoop:sleep:slp-1" && r.key === "sleep_h");
      if (!hoursRow || hoursRow.value !== night1[0].value || hoursRow.date !== night1[0].date) throw new Error(`the night lands as the engine maps it (${JSON.stringify(night1[0])}): ${JSON.stringify(hoursRow)}`);
      if (whoopRows.some((r) => r.readingId.startsWith("whoop:sleep:nap"))) throw new Error("a nap never lands");
      if ((await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.readingId, `sleep:${night1[0].date}`)) })).length) throw new Error("the manual night of that date gives way to WHOOP's");
      for (const [key, value] of [["recovery", 67], ["rhr", 51], ["hrv", 72], ["strain", 8.2]] as const) if (!whoopRows.some((r) => r.key === key && r.value === value)) throw new Error(`${key} ${value} lands from the pull`);
      const acts = await db.query.bodyActivities.findMany({ where: mine(schema.bodyActivities) });
      const liftExpected = activityOf(whoopRecords.workout[0], inTz)!;
      if (acts.length !== 3 || !acts.some((a) => a.sport === "Weightlifting" && a.minutes === liftExpected.minutes && a.strain === 10.1 && a.avgHr === 118 && a.date === liftExpected.date)) throw new Error(`three workouts land by sport with minutes, strain and heart rate: ${JSON.stringify(acts.map((a) => [a.sport, a.minutes, a.date]))}`);
      const saunaLog = await db.query.bodyHabitLogs.findFirst({ where: eq(schema.bodyHabitLogs.habitId, saunaHabit.id) });
      if (!saunaLog || saunaLog.value !== 18 || saunaLog.source !== "whoop") throw new Error("the sauna workout ticks the Sauna habit with its minutes, source whoop");
      // Phase 16b: the rest of WHOOP. Stages, bed and wake times, the cycle's calories and heart rate, the max heart rate land as daily rows.
      for (const [key, value] of [["sleep_light_min", 210], ["sleep_deep_min", 90], ["sleep_rem_min", 120], ["sleep_awake_min", 15], ["burn_cal", 1500], ["burn_cal", 2800], ["cycle_hr", 68], ["cycle_hr", 74], ["max_hr", 188]] as const) if (!whoopRows.some((r) => r.key === key && r.value === value)) throw new Error(`${key} ${value} lands from the pull`);
      if (!whoopRows.some((r) => r.key === "bedtime") || !whoopRows.some((r) => r.key === "waketime")) throw new Error("the night's bed and wake times land");
      // Every workout sits under its day's session: the lift and the sauna share one, made "From WHOOP" when the day had none.
      const lift = acts.find((a) => a.sport === "Weightlifting")!;
      const saunaAct = acts.find((a) => a.sport === "Sauna")!;
      if (!lift.sessionId || lift.sessionId !== saunaAct.sessionId || JSON.stringify(lift.zones) !== "[4,14,22,10,2,0]" || acts.find((a) => a.sport === "Walking")!.distanceM !== 3240) throw new Error(`the day's workouts share one session, with zones and distance: ${JSON.stringify(acts.map((a) => [a.sport, a.sessionId, a.zones, a.distanceM]))}`);
      const liftSession = (await db.query.bodySessions.findFirst({ where: eq(schema.bodySessions.id, lift.sessionId) }))!;
      const liftSets = await db.query.bodySets.findMany({ where: eq(schema.bodySets.sessionId, liftSession.id) });
      if (liftSession.date !== liftExpected.date || (liftSets.length === 0 && liftSession.routineName !== "From WHOOP") || (liftSets.length > 0 && liftSession.routineName === "From WHOOP")) throw new Error(`a day with sets keeps its session, a day without gets "From WHOOP": ${liftSession.routineName}, ${liftSets.length} sets`);
      if ((await db.query.bodySessions.findMany({ where: and(mine(schema.bodySessions), eq(schema.bodySessions.date, liftExpected.date)) })).length !== 1) throw new Error("one session a day, never two");
      await client.goto(`${base}/body/training?date=${liftExpected.date}`);
      await client.locator('[data-testid="training-activities"]').waitFor({ timeout: 30000 });
      if ((await client.locator('[data-testid="training-activity"]').count()) !== 2 || !(await client.locator('[data-testid="training-activity"][data-sport="Weightlifting"][data-session="1"]').count())) throw new Error("Training shows the day's two recorded workouts under the session");
      if (!(await client.locator('[data-testid="training-activity"][data-sport="Weightlifting"] [data-testid="training-activity-zones"]').textContent())?.includes("Z2 22")) throw new Error("the lift's zones show on its chip");
      // Rev 471: the sauna that ended within the hour after the lift is part of the gym visit, 78 minutes from the lift's start.
      if ((await client.locator('[data-testid="training-gym"]').getAttribute("data-minutes")) !== "78" || !((await client.locator('[data-testid="training-gym"]').textContent()) ?? "").includes("sauna 18 min")) throw new Error("the sauna after the lift is grouped as the gym visit");
      // The Sleep page shows the night's window and stages; Log shows the day's energy estimate beside intake; Settings the max heart rate.
      // The mock dates its newest night by UTC; on the member's clock (Los Angeles) that morning can still be tomorrow, and a night
      // that hasn't ended yet rightly stays off the page. So the stages are read on the newest night that is on or before today.
      await client.goto(`${base}/body/sleep`);
      await client.locator('[data-testid="sleep-night-detail"]').first().waitFor({ timeout: 30000 });
      const firstDetail = (await client.locator('[data-testid="sleep-night-detail"]').first().textContent()) ?? "";
      if (night1[0].date <= today ? !firstDetail.includes("deep 1 h 30 min") : !/\d\d:\d\d to \d\d:\d\d/.test(firstDetail)) throw new Error(`the night's window and stages show on Sleep: "${firstDetail}" (newest night ${night1[0].date}, today ${today})`);
      const cycleDate = inTz(whoopRecords.cycle[1].start); // the finished cycle, yesterday on the member's clock: 11715 kJ → 2800 cal
      await client.goto(`${base}/body?date=${cycleDate}`);
      await client.locator('[data-testid="body-burn"]').waitFor({ timeout: 30000 });
      if ((await client.locator('[data-testid="body-burn"]').getAttribute("data-cal")) !== "2800") throw new Error("Log shows the day's energy estimate from the cycle");
      await client.goto(`${base}/body/insights`);
      if (!(await client.locator('select[name="a"] option[value="bedtime_drift"]').count())) throw new Error("Patterns offers bedtime drift");
      await client.goto(`${base}/body/settings`);
      await client.locator('[data-testid="whoop-max-hr"]').waitFor({ timeout: 30000 });
      // A signed webhook for the walk's workout is handled; the same with a wrong secret is refused.
      const hook = async (badSecret: boolean) => (await (await fetch("http://localhost:4072/__webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: `${base}/api/webhooks/whoop`, event: { user_id: 4242, id: "wk-walk", type: "workout.updated" }, badSecret }) })).json()) as { status: number; body: string };
      const good = await hook(false);
      const bad = await hook(true);
      if (good.status !== 200 || !good.body.includes('"handled":true') || bad.status !== 401) throw new Error(`a signed webhook is handled (${good.status} ${good.body}) and a bad signature refused (${bad.status})`);
      // Rev 473: a stretch recorded on the device that no webhook announced. Sync now pulls from two days before the last sync,
      // finds it, and says so; the line counts it as new.
      const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      const addWorkout = async (id: string, sport: string, from: number, to: number) => fetch("http://localhost:4072/__add", { method: "POST", body: JSON.stringify({ id, user_id: 4242, start: minsAgo(from), end: minsAgo(to), sport_name: sport, score_state: "SCORED", score: { strain: 2.1, average_heart_rate: 92, max_heart_rate: 110 } }) });
      const hasActivity = async (id: string) => !!(await db.query.bodyActivities.findFirst({ where: and(mine(schema.bodyActivities), eq(schema.bodyActivities.providerId, id)) }));
      await addWorkout("wk-stretch-473", "Stretching", 50, 35);
      await client.goto(`${base}/body/settings`);
      await press(client, '[data-testid="whoop-sync"]', async () => /whoop=synced/.test(client.url()), "synced");
      const syncedLine = (await client.locator('[data-testid="whoop-just-synced"]').textContent()) ?? "";
      if (!(await hasActivity("wk-stretch-473")) || !syncedLine.includes("Synced: 1 new workout") || (await client.locator('[data-testid="whoop-last-error"]').count())) throw new Error(`Sync now finds the stretch no webhook announced and says so: "${syncedLine}"`);
      // Three webhooks at once as the access token runs out: WHOOP's refresh token works once, so one request refreshes and the
      // other two wait for the token it stored. All three are handled.
      const whoopRow = async () => (await db.query.bodyDevices.findFirst({ where: mine(schema.bodyDevices) }))!;
      await db.update(schema.bodyDevices).set({ expiresAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(schema.bodyDevices.id, (await whoopRow()).id));
      const sendHook = async (id: string) => (await (await fetch("http://localhost:4072/__webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: `${base}/api/webhooks/whoop`, event: { user_id: 4242, id, type: "workout.updated" } }) })).json()) as { status: number; body: string };
      const together = await Promise.all(["wk-walk", "wk-stretch-473", "wk-walk"].map(sendHook));
      if (together.some((h) => !h.body.includes('"handled":true')) || Date.parse((await whoopRow()).expiresAt ?? "") < Date.now()) throw new Error(`three webhooks refreshing at once are all handled: ${together.map((h) => h.body).join(" ")}`);
      // A webhook whose fetch fails says so on HumanOS settings, in words, instead of vanishing.
      await fetch("http://localhost:4072/__fail?on=1");
      await sendHook("wk-walk");
      await client.goto(`${base}/body/settings`);
      if ((await client.locator('[data-testid="whoop-last-error"]').getAttribute("data-code")) !== "other" || !((await client.locator('[data-testid="whoop-last-error"]').textContent()) ?? "").includes("WHOOP couldn't answer")) throw new Error("a failed webhook shows on HumanOS settings");
      // Sync now while WHOOP is down says why beside the button, and keeps the reason on the row.
      await press(client, '[data-testid="whoop-sync"]', async () => (await client.locator('[data-testid="whoop-sync-error"]').count()) > 0, "the sync refused");
      await fetch("http://localhost:4072/__fail?on=0");
      // The hourly catch-up: a sauna no webhook announced, and a last sync two hours old. The cron pulls it and clears the error.
      await addWorkout("wk-sauna-473", "Sauna", 30, 10);
      await db.update(schema.bodyDevices).set({ lastSyncAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }).where(eq(schema.bodyDevices.id, (await whoopRow()).id));
      const unauthorised = await fetch(`${base}/api/cron/whoop`);
      const cron = (await (await fetch(`${base}/api/cron/whoop`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "change-me"}` } })).json()) as { synced?: number };
      if (unauthorised.status !== 401 || !(cron.synced! >= 1) || !(await hasActivity("wk-sauna-473")) || (await whoopRow()).lastError !== null) throw new Error(`the hourly catch-up pulls what no webhook brought: ${JSON.stringify(cron)} ${(await whoopRow()).lastError}`);
      console.log("✓ WHOOP sync (rev 473): Sync now finds a stretch no webhook announced and says \"1 new workout\"; three webhooks refreshing together are all handled with WHOOP's single-use refresh token; a failed webhook and a failed sync both say why; the hourly catch-up brings in a sauna and clears the error");
      await client.locator('[data-testid="whoop-disconnect"]').waitFor({ timeout: 30000 });
      await press(client, '[data-testid="whoop-disconnect"]', async () => (await client.locator('[data-testid="whoop-connect"]').count()) > 0, "disconnected");
      if ((await db.query.bodyDevices.findMany({ where: mine(schema.bodyDevices) })).length || (await db.query.bodyActivities.findMany({ where: mine(schema.bodyActivities) })).length !== 5) throw new Error("Disconnect removes the row and keeps what was pulled");
      const { calls: whoopCalls } = (await (await fetch("http://localhost:4072/__calls")).json()) as { calls: { method: string; path: string }[] };
      const whoopCallsHad = (path: string) => whoopCalls.some((c) => c.path === path);
      if (!whoopCallsHad("/developer/v2/user/measurement/body")) throw new Error("the body measurement was read for the max heart rate");
      if (!whoopCalls.some((c) => c.path === "/oauth/oauth2/token" && c.method === "POST") || !whoopCalls.some((c) => c.path === "/developer/v2/activity/workout/wk-walk")) throw new Error("the code was exchanged and the webhook's one workout fetched");
      console.log(`✓ WHOOP: connected through the mock, tokens sealed and the WHOOP id read; the pull landed ${night1[0].value} h on ${night1[0].date} (the manual night giving way), recovery 67, RHR 51, HRV 72, strain 8.2 and three workouts by sport; the sauna ticked its habit (18 min, whoop); Training shows the day's workouts; a signed webhook handled, a bad one refused; Sync now; Disconnect removed the row and kept the data`);
    } finally {
      if (whoopMock.pid) process.kill(-whoopMock.pid);
    }

    // ── Private: the coach sees nothing, and a coach's export never has Body. ──
    await coach.goto(`${base}/coach/${mem.id}`);
    if (await coach.locator('[data-testid="coach-body-link"]').count()) throw new Error("the client page shows no Body card while private");
    await coach.goto(`${base}/coach/${mem.id}/body`);
    if (!(await coach.locator('[data-testid="coach-body-private"]').count()) || (await coach.locator('[data-testid="body-tiles"]').count())) throw new Error("the coach's Body view says private and shows nothing");
    const coachDump = (await (await coach.request.get(`${base}/api/export?format=json&user=${maya.id}`)).json()) as Record<string, unknown>;
    if (Object.keys(coachDump).some((k) => k.startsWith("body_"))) throw new Error("a coach's export of a client carries no Body section");
    // The coach's client table (rev 237 phase 12): the Body cell is there and empty while private.
    const bodyCell = async () => (await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"]`).innerText()).trim();
    await coach.goto(`${base}/coach`);
    if ((await bodyCell()) !== "") throw new Error(`the client table's Body cell is blank while private: "${await bodyCell()}"`);
    console.log("✓ private: no Body card, a blank Body cell on the client table, the coach's view says private, and the coach's export has no Body section");

    // ── Shared: read-only for the coach, plus a comment the client sees. ──
    await client.goto(`${base}/body/settings`);
    await press(client, '[data-testid="body-share-toggle"]', async () => /: On/.test(await client.locator('[data-testid="body-share-state"]').innerText()), "sharing on");
    // The Body cell (phase 12) reads what the query says for this client: days in band, the last weigh-in, sessions this week.
    const { coachBodyColumn } = await import("@/lib/queries/body");
    const coachUser0 = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachMem0 = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachUser0.id), eq(schema.memberships.workspaceId, mem.workspaceId)) }))!;
    const coachWs = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mem.workspaceId) }))!;
    const asCoach = { user: coachUser0, workspace: coachWs, membership: coachMem0, role: "coach" as const, tz: coachMem0.timezone || coachWs.timezone, today, hour: 12, actor: coachUser0, switchedInto: null };
    const expectedCell = (await coachBodyColumn(asCoach, [{ userId: maya.id, today }])).get(maya.id);
    if (!expectedCell || expectedCell.judged < 1 || !expectedCell.lastWeighIn || expectedCell.sessions < 1) throw new Error(`the query has a cell with judged days, a weigh-in and sessions for a sharing client: ${JSON.stringify(expectedCell)}`);
    await coach.goto(`${base}/coach`);
    if ((await bodyCell()) !== expectedCell.short) throw new Error(`the client table's Body cell reads "${await bodyCell()}", the query says "${expectedCell.short}"`);
    await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"] a`).click();
    await coach.waitForURL(/\/body/);
    if (!(await coach.locator('[data-testid="body-tile-cal"]').count())) throw new Error("the Body cell links to the client's days");
    await coach.goto(`${base}/coach/${mem.id}`);
    await coach.locator('[data-testid="coach-body-link"]').click();
    await coach.waitForURL(/\/body/);
    const coachCal = await coach.locator('[data-testid="body-tile-cal"]').innerText();
    if (!coachCal.includes(fmtMacro("cal", totals.cal))) throw new Error(`the coach reads the client's day: "${coachCal}"`);
    if (await coach.locator('[data-testid="body-log-meal"], [data-testid="body-log-food"], [data-testid="body-share-toggle"], [data-testid="body-no-targets"], [data-testid="training-log-form"]').count()) throw new Error("the coach's view has no way to log or change anything");
    if (!((await coach.locator('[data-testid="coach-composition"]').textContent()) ?? "").includes("150.4 lb")) throw new Error("the coach reads the day's weigh-in while shared");
    const coachTraining = (await coach.locator('[data-testid="coach-training"]').textContent()) ?? "";
    if (!coachTraining.includes("Bench press") || !coachTraining.includes("190 × 5 🏆") || !coachTraining.includes("10 reps")) throw new Error(`the coach reads the day's workout, PR marked: "${coachTraining}"`);
    const coachPageText = (await coach.locator("main").textContent()) ?? "";
    if (coachPageText.includes(injury) || coachPageText.includes("Health log")) throw new Error("the health log never reaches the coach, even while shared");
    // Danno (1 Oct): the coach's day view carries the client's night and habits while shared, read from the same query.
    const { coachDayExtras } = await import("@/lib/queries/body");
    const extras = await coachDayExtras(mem.workspaceId, maya.id, today, today);
    if (!extras.sleep?.hours || !extras.habits.some((h) => h.name === "Breathwork" && h.kept)) throw new Error(`the query has today's night and Breathwork kept for the coach's view: ${JSON.stringify(extras)}`);
    if (!(await coach.locator('[data-testid="coach-sleep"]').innerText()).includes(extras.sleep.hours)) throw new Error("the coach's day view shows the client's night while shared");
    const coachHabits = await coach.locator('[data-testid="coach-habits"]').innerText();
    if (!coachHabits.includes("Breathwork") || !coachHabits.includes("✓")) throw new Error(`the coach's day view shows the habits kept while shared: "${coachHabits}"`);
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
    await coach.goto(`${base}/coach`);
    if ((await bodyCell()) !== "") throw new Error(`revoking blanks the client table's Body cell: "${await bodyCell()}"`);
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
    // ── A meal from a photo (rev 237 phase 14): the member's own key, the mock model's three lines, checked and logged. ──
    {
      const { seal } = await import("@/lib/crypto");
      const { newId } = await import("@/lib/ids");
      const { totalsOf } = await import("@/lib/engine/body");
      const { spawn: spawnAi } = await import("node:child_process");
      const aiMock = spawnAi("npx", ["tsx", "scripts/mock-ai.ts", "4020"], { stdio: "ignore", detached: true });
      try {
        for (let i = 0; i < 100; i++) {
          try {
            await fetch("http://localhost:4020/__last");
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        await client.goto(`${base}/body`);
        await client.locator('[data-testid="body-photo-off"]').waitFor({ timeout: 30000 });
        if (!/AI key/.test(await client.locator('[data-testid="body-photo-off"]').innerText())) throw new Error("without a key, the Log page says the photo needs one");
        // The key goes in through Settings, as a member's would (sealed by the server with its own secret), and is checked against the mock.
        await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, mem.workspaceId), eq(schema.aiCredentials.userId, maya.id)));
        await client.goto(`${base}/settings`);
        await client.selectOption('select[name="provider"]', "anthropic");
        await fillExact(client, 'input[name="key"]', "sk-ant-good");
        await press(client, 'button:has-text("Connect and check"), button:has-text("Replace and check")', async () => !!(await db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, mem.workspaceId), eq(schema.aiCredentials.userId, maya.id)) })), "the member's AI key saved");
        void seal;
        void newId;
        await client.goto(`${base}/body`);
        const photoFold = client.locator('details:has([data-testid="body-photo"]) > summary');
        await photoFold.waitFor({ timeout: 30000 });
        if (!(await photoFold.evaluate((el) => (el.parentElement as HTMLDetailsElement).open))) await photoFold.click();
        await client.locator('[data-testid="body-photo-file"]').waitFor({ timeout: 30000 });
        // A 2 × 2 PNG: enough for the phone-side shrink to produce a JPEG to send.
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQImWP4z8DAwMDAwPD//38GBgYAHiQEAhMtBaUAAAAASUVORK5CYII=", "base64");
        await client.locator('[data-testid="body-photo-file"]').setInputFiles({ name: "plate.png", mimeType: "image/png", buffer: png });
        await client.locator('[data-testid="body-photo-preview"]').waitFor({ timeout: 30000 });
        await press(client, '[data-testid="body-photo-read"]', async () => (await client.locator('[data-testid="body-photo-line"]').count()) === 3, "the plate read");
        const lastAi = (await (await fetch("http://localhost:4020/__last")).json()) as { system: { text: string; cached: boolean }[]; images: number; imageBytes: number };
        if (lastAi.images !== 1 || !(lastAi.imageBytes > 100)) throw new Error(`the photo went to the model once: ${JSON.stringify({ images: lastAi.images, bytes: lastAi.imageBytes })}`);
        if (lastAi.system.some((b) => /voice you write in/.test(b.text) || b.cached) || !lastAi.system.some((b) => /meal photo/.test(b.text))) throw new Error("the photo call carries the task alone: no Essence, nothing cached");
        const { parsePhotoLines: parse, photoItems: itemsOf } = await import("@/lib/engine/body-photo");
        const modelLines = parse(JSON.stringify({ lines: [{ name: "Grilled chicken breast", qty: 6, unit: "oz", cal: 280, p: 52, f: 6, c: 0 }, { name: "White rice", qty: 1, unit: "cup", cal: 205, p: 4.3, f: 0.4, c: 45 }, { name: "Steamed broccoli", qty: 1, unit: "cup", cal: 55, p: 3.7, f: 0.6, c: 11 }] })).lines;
        const shown = await client.locator('[data-testid="body-photo-qty"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        if (JSON.stringify(shown) !== JSON.stringify(modelLines.map((l) => String(l.qty)))) throw new Error(`the lines show the model's amounts: ${JSON.stringify(shown)}`);
        // Eight ounces of the chicken, the broccoli unticked: the entry carries two lines, scaled from the model's portions.
        await fillExact(client, '[data-testid="body-photo-line"] >> nth=0 >> [data-testid="body-photo-qty"]', "8");
        await client.locator('[data-testid="body-photo-line"] >> nth=2 >> [data-testid="body-photo-use"]').uncheck();
        const entriesBefore = (await db.query.bodyEntries.findMany({ where: mine(schema.bodyEntries) })).length;
        await press(client, '[data-testid="body-photo-log"]', async () => (await db.query.bodyEntries.findMany({ where: mine(schema.bodyEntries) })).length === entriesBefore + 1, "the photo meal logged");
        const photoEntry = (await db.query.bodyEntries.findMany({ where: and(mine(schema.bodyEntries), eq(schema.bodyEntries.name, "From a photo")) }))[0];
        const wantItems = itemsOf([{ ...modelLines[0], qty: 8, cal: 373.3, p: 69.3, f: 8, c: 0 }, modelLines[1]]);
        if (!photoEntry || photoEntry.date !== today || JSON.stringify(photoEntry.items.map((i) => [i.name, i.qty, i.unit])) !== JSON.stringify(wantItems.map((i) => [i.name, i.qty, i.unit]))) throw new Error(`the entry holds the two ticked lines with the typed amount: ${JSON.stringify(photoEntry?.items)}`);
        if (Math.abs(photoEntry.cal - totalsOf(wantItems).cal) > 0.5) throw new Error(`the entry's calories scale with the amount: ${photoEntry.cal} vs ${totalsOf(wantItems).cal}`);
        const usage = await db.query.aiUsage.findMany({ where: and(eq(schema.aiUsage.userId, maya.id), eq(schema.aiUsage.feature, "meal_photo")) });
        if (usage.length !== 1 || JSON.stringify(usage[0]).includes(png.toString("base64").slice(0, 20))) throw new Error("one usage row, feature meal_photo, with nothing of the photo in it");
        // The week in a paragraph (phase 15): the numbers go, nothing named, and the mock's paragraph lands on the page.
        await client.goto(`${base}/body/week`);
        await press(client, '[data-testid="week-summary-button"]', async () => (await client.locator('[data-testid="week-summary-text"]').count()) > 0, "the week summarised");
        if (!(await client.locator('[data-testid="week-summary-text"]').innerText()).includes("Mock AI week summary")) throw new Error("the summary on the page is the model's paragraph");
        const lastSum = (await (await fetch("http://localhost:4020/__last")).json()) as { system: { text: string; cached: boolean }[]; images: number; user: string };
        if (lastSum.images !== 0 || !lastSum.system.some((b) => /week summary/i.test(b.text)) || lastSum.system.some((b) => b.cached)) throw new Error("the summary call carries the task alone, no image, nothing cached");
        if (!/Days logged: \d+ of \d+/.test(lastSum.user) || !/Training: \d+ sessions/.test(lastSum.user)) throw new Error(`the model gets the week's numbers: ${lastSum.user.slice(0, 200)}`);
        if (lastSum.user.includes(MEALS[0].name) || lastSum.user.includes(fx("egg").name) || /photo|note/i.test(lastSum.user)) throw new Error("the model gets numbers only: no food, no note, no photo");
        // The entry leaves again, and so does the key, so the day's totals below are the ones the walk built by hand.
        await db.delete(schema.bodyEntries).where(eq(schema.bodyEntries.id, photoEntry.id));
        await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, mem.workspaceId), eq(schema.aiCredentials.userId, maya.id)));
        console.log("✓ a meal from a photo: the plate read by the member's own model (one image, no Essence), three lines shown, one amount changed and one line unticked, logged as one entry with scaled macros; the usage row names the feature and nothing of the photo");
      } finally {
        if (aiMock.pid) process.kill(-aiMock.pid);
      }
      // Back where the AI section left the client, for the switch-off press below.
      await client.goto(`${base}/body/settings`);
      await client.locator('[data-testid="body-ai-toggle"]').waitFor({ timeout: 30000 });
    }
    const aiText = await bodyAiContext(await viewerFor());
    if (!aiText || !aiText.includes(MEALS[0].name) || !aiText.includes(`${fmtMacro("cal", totals.cal)} cal`)) throw new Error(`with the switch on, AI gets today's numbers and logged meals: ${aiText}`);
    if (aiText.includes(note)) throw new Error("the coach's comment never goes to AI");
    if (!aiText.includes("Latest weigh-in") || !aiText.includes("150.4 lb")) throw new Error(`with the switch on, AI gets the latest weigh-in: ${aiText}`);
    if (!aiText.includes(`${ROUTINE.name}: Bench press 190 × 5`) || !aiText.includes("Bench press 185 × 5, 185 × 5")) throw new Error(`with the switch on, AI gets the week's workouts: ${aiText}`);
    // WHOOP's pull (above) replaced the hand-logged night, so the night expected is whatever the sleep query holds now.
    const { sleepView: sleepNow } = await import("@/lib/queries/body");
    const lastNight = (await sleepNow(mem.workspaceId, maya.id, today))!.last!.text;
    if (!aiText.includes("Sleep: ") || !aiText.includes(lastNight) || !aiText.includes("Habits: ") || !aiText.includes("Breathwork ✓")) throw new Error(`with the switch on, AI gets last night's sleep and the habits kept: ${aiText}`);
    if (aiText.includes(injury) || /injur|health log/i.test(aiText)) throw new Error("the health log never goes to AI");
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
    // Rev 293: a set that ties today's PR says so, and the day's summary names today's PR; the extra set then goes so the counts below hold.
    const tieTool = await tool("body_log_set").handler(await viewerFor(), { exercise: "bench", weight: 190, reps: 5 });
    if (!tieTool.text.includes("Today's PR stands at 190 × 5")) throw new Error(`a second 190 × 5 today reads today's PR, not an older one: "${tieTool.text}"`);
    const tieDay = await tool("body_training").handler(await viewerFor(), {});
    if (!tieDay.text.includes("190 × 5") || /PR[^\n]*2026-0[1-8]/.test(tieDay.text)) throw new Error(`the day's summary names today's PR: "${tieDay.text.slice(0, 300)}"`);
    const tieSet = (await db.query.bodySets.findMany({ where: and(mine(schema.bodySets), eq(schema.bodySets.date, today)) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    await db.delete(schema.bodySets).where(eq(schema.bodySets.id, tieSet.id));
    const setTool = await tool("body_log_set").handler(await viewerFor(), { exercise: "bench", weight: 180, reps: 8, date: yesterday });
    if (!setTool.text.includes("180 × 8") || (await db.query.bodySets.findMany({ where: and(mine(schema.bodySets), eq(schema.bodySets.date, yesterday)) })).length !== 3) throw new Error(`body_log_set adds a set to yesterday's session: ${setTool.text}`);
    // The post-workout read by voice (rev 471): the same lines Training shows.
    const { workoutReadFor: readFor } = await import("@/lib/queries/body");
    const readTool = await tool("body_workout_read").handler(await viewerFor(), { date: today });
    const readNow = await readFor(mem.workspaceId, maya.id, today);
    if (!readNow || !readTool.text.startsWith(readNow.lines.join("\n"))) throw new Error(`body_workout_read reads the day back: ${readTool.text.slice(0, 300)}`);
    const weighTool = await tool("body_log_weigh_in").handler(await viewerFor(), { weight: 151.2, bodyFat: 21.5, date: yesterday, time: "07:00" });
    if (!weighTool.text.includes("151.2 lb") || !weighTool.text.includes("21.5%")) throw new Error(`body_log_weigh_in logs the reading: ${weighTool.text}`);
    // Rev 476: the same step read off a RENPHO screenshot takes every number the first lacked and stays one reading, marked
    // RENPHO where it added; told again without a time at the same weight, it adds nothing. The page shows every number on tap.
    const renphoTool = await tool("body_log_weigh_in").handler(await viewerFor(), { weight: 151.3, bodyFat: 21.6, muscleMass: 112.4, boneMass: 6.9, protein: 17.2, subcutaneousFat: 16.1, bmi: 22.4, skeletalMuscle: 50.2, source: "renpho", date: yesterday, time: "07:00" });
    const againTool = await tool("body_log_weigh_in").handler(await viewerFor(), { weight: 151.2, date: yesterday });
    const { groupReadings: grouped } = await import("@/lib/queries/body");
    const sevenAm = grouped(await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.date, yesterday)) })).filter((r) => r.time === "07:00");
    const sevenRows = await db.query.bodyDaily.findMany({ where: and(mine(schema.bodyDaily), eq(schema.bodyDaily.readingId, sevenAm[0]?.readingId ?? "")) });
    if ((renphoTool.data as { outcome?: string }).outcome !== "filled" || (againTool.data as { outcome?: string }).outcome !== "already" || sevenAm.length !== 1 || sevenAm[0].values.weight !== 151.2 || sevenAm[0].values.bf !== 21.5 || sevenAm[0].values.bone_mass !== 6.9 || sevenAm[0].values.bmi !== 22.4 || sevenRows.find((x) => x.key === "protein")?.source !== "renpho" || sevenRows.find((x) => x.key === "weight")?.source !== "manual") throw new Error(`a RENPHO reading of the same step fills in and stays one: ${renphoTool.text} / ${againTool.text} / ${JSON.stringify(sevenAm.map((r) => r.values))}`);
    await client.goto(`${base}/body/weight`);
    const more = client.locator(`[data-testid="weigh-reading-more"][data-reading="${sevenAm[0].readingId}"]`);
    await more.locator("summary").click();
    const shownKeys = await more.locator('[data-testid="weigh-reading-value"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    for (const k of ["weight", "bf", "ffm", "fat_mass", "muscle_mass", "bone_mass", "protein", "subq_fat", "bmi", "smm_pct"]) if (!shownKeys.includes(k)) throw new Error(`the opened reading shows ${k}: ${shownKeys.join(",")}`);
    if (!((await more.locator('[data-key="ffm"]').textContent()) ?? "").includes("worked out")) throw new Error("fat-free mass the scale didn't give is shown, worked out");
    if (!(await client.locator('nav a[href="/body/weight"]').count())) throw new Error("Weigh-ins is in the HumanOS menu");
    const refused = await tool("body_log_food").handler(await viewerFor(), { food: "unicorn", qty: 1 }).then(() => "logged", (e: Error) => e.message);
    if (!refused.startsWith('No food called "unicorn"') || !refused.includes(fx("egg").name)) throw new Error(`an unknown food is refused with the names to pick from: ${refused}`);
    // Setting HumanOS up by voice (Danno, rev 417): a food, a meal from it, a starter habit, an exercise onto a routine, day types read
    // and set. Each refuses a duplicate; each write says what it did or replaced; then the walk takes it all back so the counts below hold.
    const addFood = await tool("body_add_food").handler(await viewerFor(), { name: "Walk oats", unit: "grams", cal: 3.8, p: 0.13, f: 0.07, c: 0.66, section: "pantry" });
    const oats = (await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).find((x) => x.name === "Walk oats");
    if (!oats || oats.unit !== "g" || oats.cal !== 3.8 || oats.section !== "pantry" || !addFood.text.startsWith("Added Walk oats, per g")) throw new Error(`body_add_food adds a food per its unit, read onto the list: ${addFood.text}`);
    const dupFood = await tool("body_add_food").handler(await viewerFor(), { name: "walk OATS", unit: "g", cal: 1, p: 0, f: 0, c: 0 }).then(() => "added", (e: Error) => e.message);
    if (!dupFood.startsWith('"Walk oats" is already one of their foods (per g')) throw new Error(`a food already there is refused and offered back: ${dupFood}`);
    const egg = fx("egg").name;
    const saveMeal = await tool("body_save_meal").handler(await viewerFor(), { name: "Walk oats bowl", slot: "breakfast", lines: [{ food: "walk oats", qty: 80 }, { food: egg, qty: 2 }] });
    const bowl = (await db.query.bodyMeals.findMany({ where: mine(schema.bodyMeals) })).find((m) => m.name === "Walk oats bowl");
    if (!bowl || bowl.slot !== "Breakfast" || bowl.items.length !== 2 || bowl.items[0].foodId !== oats.id || !saveMeal.text.includes("Totals: ")) throw new Error(`body_save_meal saves lines from existing foods with its totals: ${saveMeal.text}`);
    const dupMeal = await tool("body_save_meal").handler(await viewerFor(), { name: "walk oats bowl", lines: [{ food: egg, qty: 1 }] }).then(() => "saved", (e: Error) => e.message);
    const noFood = await tool("body_save_meal").handler(await viewerFor(), { name: "Walk ghost", lines: [{ food: "unicorn", qty: 1 }] }).then(() => "saved", (e: Error) => e.message);
    if (!dupMeal.includes("is already a saved meal") || !noFood.startsWith('No food called "unicorn"')) throw new Error(`a meal name already saved and a food that isn't there are refused: ${dupMeal} / ${noFood}`);
    const addHabit = await tool("body_add_habit").handler(await viewerFor(), { name: "sunlight", days: [1, 3, 5] });
    const sun = (await db.query.bodyHabits.findMany({ where: mine(schema.bodyHabits) })).find((h) => h.name === "Sunlight");
    if (!sun || sun.kind !== "minutes" || sun.target !== 10 || JSON.stringify(sun.days) !== "[1,3,5]" || !addHabit.text.startsWith("Added Sunlight: 10 min")) throw new Error(`body_add_habit takes a starter by name with its kind and target: ${addHabit.text}`);
    const dupHabit = await tool("body_add_habit").handler(await viewerFor(), { name: "Sunlight" }).then(() => "added", (e: Error) => e.message);
    if (!dupHabit.includes("is already one of their habits")) throw new Error(`an active habit is refused: ${dupHabit}`);
    const routineBefore = (await db.query.bodyRoutines.findMany({ where: mine(schema.bodyRoutines) })).find((r) => r.name === ROUTINE.name)!;
    const addEx = await tool("body_add_exercise").handler(await viewerFor(), { name: "Walk face pull", routine: ROUTINE.name, sets: 3, reps: "15" });
    const facePull = (await db.query.bodyExercises.findMany({ where: mine(schema.bodyExercises) })).find((e) => e.name === "Walk face pull");
    const routineAfter = (await db.query.bodyRoutines.findMany({ where: mine(schema.bodyRoutines) })).find((r) => r.id === routineBefore.id)!;
    if (!facePull || routineAfter.items.length !== routineBefore.items.length + 1 || routineAfter.items.at(-1)!.exerciseId !== facePull.id || routineAfter.items.at(-1)!.reps !== "15" || !addEx.text.includes(`put it on ${ROUTINE.name}`)) throw new Error(`body_add_exercise adds the exercise and puts it on the routine: ${addEx.text}`);
    const dupEx = await tool("body_add_exercise").handler(await viewerFor(), { name: "bench press" }).then(() => "added", (e: Error) => e.message);
    if (!dupEx.includes("is already one of their exercises")) throw new Error(`an exercise already there with no routine named is refused: ${dupEx}`);
    const typesRead = await tool("body_day_types").handler(await viewerFor(), {});
    const typesNow = await db.query.bodyDayTypes.findMany({ where: mine(schema.bodyDayTypes) });
    const firstType = typesNow.sort((a, b) => a.order - b.order)[0];
    if (!typesNow.every((t) => typesRead.text.includes(`${t.name}: `)) || !/Week: Mon /.test(typesRead.text) || !/Today is /.test(typesRead.text)) throw new Error(`body_day_types lists each type with its bands, the week and today: ${typesRead.text}`);
    const flipDate = addDays(today, -3);
    const dayRowBefore = await db.query.bodyDays.findFirst({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.date, flipDate)) });
    const setType = await tool("body_set_day_type").handler(await viewerFor(), { dayType: firstType.name, bands: { p: { min: 175, max: 205 } }, date: flipDate });
    const typeAfter = (await db.query.bodyDayTypes.findMany({ where: mine(schema.bodyDayTypes) })).find((t) => t.id === firstType.id)!;
    const dayRowAfter = await db.query.bodyDays.findFirst({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.date, flipDate)) });
    if (typeAfter.pMin !== 175 || typeAfter.pMax !== 205 || dayRowAfter?.dayTypeId !== firstType.id || !setType.text.includes("(was ") || !setType.text.includes(`${flipDate} now runs as ${firstType.name}`)) throw new Error(`body_set_day_type sets a band, says what it replaced, and runs a date as the type: ${setType.text}`);
    const halfBand = await tool("body_set_day_type").handler(await viewerFor(), { dayType: firstType.name, bands: { f: { min: 80, max: 60 } } }).then(() => "set", (e: Error) => e.message);
    if (!halfBand.includes("top can't be under its bottom")) throw new Error(`a band upside down is refused as the form refuses it: ${halfBand}`);
    // Back as it was: the made rows go, the routine and the day type and the date return.
    await db.delete(schema.bodyMeals).where(eq(schema.bodyMeals.id, bowl.id));
    await db.delete(schema.bodyFoods).where(eq(schema.bodyFoods.id, oats.id));
    await db.delete(schema.bodyHabits).where(eq(schema.bodyHabits.id, sun.id));
    await db.update(schema.bodyRoutines).set({ items: routineBefore.items }).where(eq(schema.bodyRoutines.id, routineBefore.id));
    await db.delete(schema.bodyExercises).where(eq(schema.bodyExercises.id, facePull.id));
    await db.update(schema.bodyDayTypes).set({ pMin: firstType.pMin, pMax: firstType.pMax }).where(eq(schema.bodyDayTypes.id, firstType.id));
    if (dayRowBefore) await db.update(schema.bodyDays).set({ dayTypeId: dayRowBefore.dayTypeId }).where(eq(schema.bodyDays.id, dayRowBefore.id));
    else await db.delete(schema.bodyDays).where(and(mine(schema.bodyDays), eq(schema.bodyDays.date, flipDate)));
    console.log("✓ set-up tools: a food added per its unit and a duplicate offered back; a meal saved from it with its totals; Sunlight from the starters; an exercise put on a routine; day types read, a band set saying what it replaced, a date run as a type; every duplicate and an upside-down band refused");
    const trainTool = await tool("body_training").handler(await viewerFor(), { exercise: "Bench press" });
    if (!trainTool.text.includes("PR 190 × 5")) throw new Error(`body_training gives an exercise's history: ${trainTool.text}`);
    const wiTool = await tool("body_weigh_ins").handler(await viewerFor(), {});
    if (!wiTool.text.includes("7-day average") || !wiTool.text.includes("150.4 lb")) throw new Error(`body_weigh_ins gives the trend: ${wiTool.text}`);
    if (!/Habits: \d+ of \d+ kept/.test(todayTool.text) || todayTool.text.includes(injury)) throw new Error(`body_today carries the habits kept, never the health log: ${todayTool.text}`);
    const habitsTool = await tool("body_habits").handler(await viewerFor(), {});
    if (!habitsTool.text.includes("Breathwork") || !habitsTool.text.includes("streak 4") || !habitsTool.text.includes("Meditation (10 min a day): kept")) throw new Error(`body_habits reads the day's habits with streaks: ${habitsTool.text}`);
    const habitTool = await tool("body_log_habit").handler(await viewerFor(), { habit: "evening", value: 7000, date: yesterday });
    if (!habitTool.text.includes("7000 steps")) throw new Error(`body_log_habit logs a measured habit by name: ${habitTool.text}`);
    const sleepTool = await tool("body_sleep").handler(await viewerFor(), {});
    if (!sleepTool.text.includes(lastNight) || !sleepTool.text.includes("This week")) throw new Error(`body_sleep gives last night and the week: ${sleepTool.text}`);
    const sleepLog = await tool("body_log_sleep").handler(await viewerFor(), { hours: "7:15", date: addDays(today, -2) });
    if (!sleepLog.text.includes("7 h 15 min")) throw new Error(`body_log_sleep takes a time: ${sleepLog.text}`);
    for (const txt of [habitsTool.text, habitTool.text, sleepTool.text, sleepLog.text]) if (txt.includes(injury)) throw new Error("no tool carries the health log");
    const corrTool = await tool("body_correlation").handler(await viewerFor(), { a: "sleep hours", b: "calls booked", lag: 1 });
    // A night was logged through a tool above, so the pairs grew by one since the page's check: the shape is what's fixed.
    if (!corrTool.text.includes("Sleep hours and Calls booked moved together") || !/r 0\.\d\d, \d+ paired days, early signal/.test(corrTool.text) || !corrTool.text.includes("B read 1 day after A") || corrTool.text.includes(injury)) throw new Error(`body_correlation gives the readout in the engine's words: ${corrTool.text}`);
    const corrList = await tool("body_correlation").handler(await viewerFor(), {});
    const weekRange = await tool("body_week").handler(await viewerFor(), { range: "90d" });
    if (!weekRange.text.startsWith("90 days to") || !weekRange.text.includes(`Training: ${rq.training.sessions} sessions`) || !weekRange.text.includes("Habits:")) throw new Error(`body_week over 90 days gives the range's rollup: ${weekRange.text}`);
    const sleepRangeTool = await tool("body_sleep").handler(await viewerFor(), { range: "month" });
    if (!sleepRangeTool.text.includes("a night over")) throw new Error(`body_sleep over a month: ${sleepRangeTool.text}`);
    const habitsRangeTool = await tool("body_habits").handler(await viewerFor(), { range: "90d" });
    if (!habitsRangeTool.text.includes("Breathwork:")) throw new Error(`body_habits over 90 days: ${habitsRangeTool.text}`);
    const listTool = await tool("body_shopping_list").handler(await viewerFor(), {});
    if (!listTool.text.includes(`${MEALS[0].name} × 2`)) throw new Error(`body_shopping_list reads the plan and the list: ${listTool.text}`);
    // Even confirmed and with a key set, the tool sends nothing while Instacart is closed (Danno, rev 429); it gives the list in words.
    process.env.INSTACART_API_KEY = "test-instacart-key";
    const notSent = await tool("push_to_instacart_cart").handler(await viewerFor(), { confirm: true });
    if (!notSent.text.startsWith("Instacart: coming soon. Instacart isn't taking new partners yet") || !notSent.text.includes("Nothing was sent") || (notSent.data as { sent?: boolean } | undefined)?.sent !== false || (await db.query.bodyOrders.findMany({ where: mine(schema.bodyOrders) })).length) throw new Error(`the tool says coming soon and sends nothing: ${notSent.text}`);
    if (!corrList.text.includes("Presets:") || !corrList.text.includes("Breathwork")) throw new Error("without metrics, the tool lists the presets and the member's metrics, habits included");
    await press(client, '[data-testid="body-ai-toggle"]', async () => /: Off/.test(await client.locator('[data-testid="body-ai-state"]').innerText()), "AI use off");
    if ((await bodyAiContext(await viewerFor())) !== null) throw new Error("switching it off stops it on the next request");
    const offAnswer = await tool("body_today").handler(await viewerFor(), {}).then(() => "answered", (e: Error) => e.message);
    if (!offAnswer.includes("AI switch is off")) throw new Error(`with the switch off, every Body tool refuses: ${offAnswer}`);
    const aiLog = await client.locator('[data-testid="body-share-log"] li[data-kind="ai"]').count();
    const aiEvents = (await db.query.bodyShareEvents.findMany({ where: mine(schema.bodyShareEvents) })).filter((e) => e.kind === "ai");
    if (aiLog !== 2 || aiEvents.length !== 2) throw new Error(`both AI changes are logged and shown: ${aiEvents.length} logged, ${aiLog} shown`);
    console.log("✓ AI use: off by default (no Body data), on gives today's numbers and meals but never the coach's comment, off again stops it on the next request; independent of coach sharing; both changes logged. MCP tools: the day, foods, a meal, a food in grams, a set and a weigh-in logged on yesterday, an unknown food refused with the names, an exercise's history, the trend; refused with the switch off");

    // ── Nothing a member reads or picks is cut off (1 Oct rule): no truncation class on any HumanOS page at phone width. ──
    {
      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await login(phone, maya.email);
      for (const path of ["/body", "/body/foods", "/body/foods/find", "/body/pantry", "/body/shopping", "/body/training", "/body/training/routines", "/body/weight", "/body/week", "/body/sleep", "/body/practices", "/body/practices/meds", "/body/insights", "/body/settings"]) {
        await phone.goto(`${base}${path}`);
        await phone.locator("main").waitFor({ timeout: 30000 });
        // A chart's tick labels (dates under the bars, main's shared chart) are not a member's own words; everything else wraps.
        const cut = await phone.locator('main .truncate:not([data-tick]), main [class*="line-clamp"], main .text-ellipsis').count();
        if (cut) throw new Error(`${path} cuts text off with an ellipsis (${cut} places); a member's own words wrap instead`);
      }
      await phone.context().close();
      console.log("✓ no cut-off: thirteen HumanOS pages at phone width carry no truncation class");
    }

    // ── B9 (rev 237; revs 196, 200, 353): coach templates one way, and the weekly check-in with sharing off. ──
    const coachUserB9 = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachMemB9 = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, coachUserB9.id), eq(schema.memberships.workspaceId, mem.workspaceId)) }))!;
    // The coach's own HumanOS, straight into the rows: a day type with bands, a food and a meal, two exercises (one the client also has) and a routine.
    await db.update(schema.memberships).set({ bodyEnabled: true }).where(eq(schema.memberships.id, coachMemB9.id));
    const cDay = freshId();
    const cFood = freshId();
    const cMeal = freshId();
    const cBench = freshId();
    const cRow = freshId();
    const cRoutine = freshId();
    const coachRows = <T extends object>(t: T) => ({ ...t, workspaceId: mem.workspaceId, userId: coachUserB9.id });
    await db.insert(schema.bodySettings).values(coachRows({ id: freshId(), weekPattern: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), cDay])) }));
    await db.insert(schema.bodyDayTypes).values(coachRows({ id: cDay, name: "Coach cut day", order: 0, calMin: 1600, calMax: 1800, pMin: 170, pMax: 200, reminder: "Water first." }));
    await db.insert(schema.bodyFoods).values(coachRows({ id: cFood, name: "Coach oats", unit: "g", cal: 3.8, p: 0.13, f: 0.07, c: 0.66 }));
    await db.insert(schema.bodyMeals).values(coachRows({ id: cMeal, name: "Coach breakfast", slot: "Breakfast", items: [{ foodId: cFood, qty: 80 }] }));
    await db.insert(schema.bodyExercises).values([coachRows({ id: cBench, name: "Bench press", kind: "weight" as const }), coachRows({ id: cRow, name: "Coach row", kind: "weight" as const })]);
    await db.insert(schema.bodyRoutines).values(coachRows({ id: cRoutine, name: "Coach push day", dayTypeId: null, items: [{ exerciseId: cBench, sets: 3, reps: "8" }, { exerciseId: cRow, sets: 3, reps: "10" }] }));
    const clientFoodName = (await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).map((f) => f.name).find((n) => !n.startsWith("Coach"))!;
    await coach.goto(`${base}/coach/${mem.id}`);
    await coach.locator('[data-testid="template-form"]').waitFor({ timeout: 30000 });
    for (const pick of [`day_type:${cDay}`, `meal:${cMeal}`, `routine:${cRoutine}`]) {
      await coach.locator('[data-testid="template-pick"]').selectOption(pick);
      await press(coach, '[data-testid="template-send"]', async () => /template=sent/.test(coach.url()) && (await coach.locator('[data-testid="template-just-sent"]').count()) > 0, `sent ${pick.split(":")[0]}`);
      await coach.goto(`${base}/coach/${mem.id}`);
      await coach.locator('[data-testid="template-form"]').waitFor({ timeout: 30000 });
    }
    const sendsB9 = await db.query.bodyTemplateSends.findMany({ where: mine(schema.bodyTemplateSends) });
    const mealSend = sendsB9.find((s) => s.kind === "meal")!;
    if (sendsB9.length !== 3 || sendsB9.some((s) => s.status !== "sent" || s.coachUserId !== coachUserB9.id) || !JSON.stringify(mealSend.payload).includes("Coach oats") || JSON.stringify(mealSend.payload).includes(cFood)) throw new Error(`three sends wait on the client as snapshots with the foods copied in by value: ${JSON.stringify(sendsB9.map((s) => [s.kind, s.status]))}`);
    if ((await coach.locator('[data-testid="template-send-row"][data-status="sent"]').count()) !== 3) throw new Error("the coach's list shows the three waiting");
    const coachClientText = (await coach.locator("main").textContent()) ?? "";
    if (coachClientText.includes(clientFoodName) || (await coach.locator('[data-testid="coach-body-link"]').count())) throw new Error("sending a template reads nothing of the client's: no food of theirs, no Body card while private");
    // The client: all three on Log; the day type taken on Settings, the routine on Routines (Bench press matched by name, Coach row made), the meal declined on Nutrition.
    await client.goto(`${base}/body`);
    await client.locator('[data-testid="coach-sends"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="coach-send"]').count()) !== 3) throw new Error("Log shows the three templates from the coach");
    await client.goto(`${base}/body/settings`);
    await client.locator('[data-testid="coach-send"][data-kind="day_type"]').waitFor({ timeout: 30000 });
    if ((await client.locator('[data-testid="coach-send"]').count()) !== 1) throw new Error("Settings shows only the day type");
    await press(client, '[data-testid="coach-send"][data-kind="day_type"] [data-testid="coach-send-accept"]', async () => (await client.locator('[data-testid="coach-send"]').count()) === 0, "day type accepted");
    const takenDay = (await db.query.bodyDayTypes.findMany({ where: mine(schema.bodyDayTypes) })).find((t) => t.name === "Coach cut day");
    if (!takenDay || takenDay.calMin !== 1600 || takenDay.reminder !== "Water first.") throw new Error("the accepted day type is the client's own copy with its bands and reminder");
    const exercisesBefore = (await db.query.bodyExercises.findMany({ where: mine(schema.bodyExercises) })).length;
    await client.goto(`${base}/body/training/routines`);
    await client.locator('[data-testid="coach-send"][data-kind="routine"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="coach-send"][data-kind="routine"] [data-testid="coach-send-accept"]', async () => (await client.locator('[data-testid="coach-send"]').count()) === 0, "routine accepted");
    const takenRoutine = (await db.query.bodyRoutines.findMany({ where: mine(schema.bodyRoutines) })).find((r) => r.name === "Coach push day");
    const exercisesAfter = await db.query.bodyExercises.findMany({ where: mine(schema.bodyExercises) });
    if (!takenRoutine || takenRoutine.items.length !== 2 || takenRoutine.items[0].exerciseId !== bench.id || exercisesAfter.length !== exercisesBefore + 1 || !exercisesAfter.some((e) => e.name === "Coach row")) throw new Error("the routine is copied: Bench press matched by name, Coach row made, two lines");
    await client.goto(`${base}/body/foods`);
    await client.locator('[data-testid="coach-send"][data-kind="meal"]').waitFor({ timeout: 30000 });
    await press(client, '[data-testid="coach-send"][data-kind="meal"] [data-testid="coach-send-decline"]', async () => (await client.locator('[data-testid="coach-send"]').count()) === 0, "meal declined");
    if ((await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).some((f) => f.name === "Coach oats") || (await db.query.bodyTemplateSends.findMany({ where: mine(schema.bodyTemplateSends) })).map((s) => s.status).sort().join() !== "accepted,accepted,declined") throw new Error("declining makes nothing; the three sends stand as accepted, accepted, declined");
    await coach.goto(`${base}/coach/${mem.id}`);
    if ((await coach.locator('[data-testid="template-send-row"][data-status="accepted"]').count()) !== 2 || (await coach.locator('[data-testid="template-send-row"][data-status="declined"]').count()) !== 1) throw new Error("the coach sees each send's standing");
    // The weekly check-in, sharing off: the week's lines and a note go; the coach reads it on the client page and sees the mark on the roster.
    await client.goto(`${base}/body/week`);
    await client.locator('[data-testid="checkin-fold"] > summary').click();
    await fillExact(client, '[data-testid="checkin-note-input"]', "Travel week, but I kept the protein up.");
    await press(client, '[data-testid="checkin-send"]', async () => /checkin=sent/.test(client.url()) && (await client.locator('[data-testid="checkin-sent"]').count()) > 0, "check-in sent");
    const checkinRow = (await db.query.bodyCheckins.findMany({ where: mine(schema.bodyCheckins) }))[0];
    if (!checkinRow || checkinRow.monday !== mondayOf(today) || !checkinRow.lines.some((l) => l.startsWith("Days logged:")) || checkinRow.lines.some((l) => l.includes(clientFoodName)) || checkinRow.note !== "Travel week, but I kept the protein up.") throw new Error("the check-in is this week's numbers as lines, no food named, plus the note");
    await coach.goto(`${base}/coach`);
    if (!(await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"] [data-testid="coach-checkin-mark"]`).count())) throw new Error("the roster marks the week's check-in while the client's days stay private");
    await coach.goto(`${base}/coach/${mem.id}`);
    if ((await coach.locator('[data-testid="coach-checkin"]').count()) !== 1 || !(await coach.locator('[data-testid="coach-checkin-note"]').textContent())?.includes("kept the protein up") || (await coach.locator('[data-testid="coach-body-link"]').count())) throw new Error("the coach reads the sent check-in and still nothing else");
    console.log("✓ B9: three templates sent from the coach's own library as snapshots, the client took the day type and the routine (Bench press matched, Coach row made) and declined the meal, the coach read nothing of theirs; the week's check-in went with sharing off, the coach read it and the roster marks it");

    // ── The member's own export, then delete-all. ──
    const own = (await (await client.request.get(`${base}/api/export?format=json&scope=body`)).json()) as Record<string, unknown[]>;
    if ((own.body_template_sends ?? []).length !== 3 || (own.body_checkins ?? []).length !== 1) throw new Error("the member's Body export has the coach's sends and their check-in");
    const coachDumpB9 = (await (await coach.request.get(`${base}/api/export?format=json&user=${maya.id}`)).json()) as Record<string, unknown>;
    if (Object.keys(coachDumpB9).some((k) => k.startsWith("body_"))) throw new Error("a coach's export of a client carries no check-in or template");
    // The member takes the check-in back; it goes for the coach too.
    await client.goto(`${base}/body/week`);
    await press(client, '[data-testid="checkin-delete"]', async () => (await client.locator('[data-testid="checkin-sent"]').count()) === 0, "check-in deleted");
    await coach.goto(`${base}/coach/${mem.id}`);
    if (await coach.locator('[data-testid="coach-checkin"]').count()) throw new Error("a deleted check-in is gone for the coach");
    if (!(own.body_daily ?? []).length || (own.body_goals ?? []).length !== 1) throw new Error("the member's Body export has their weigh-ins and goals");
    // Phase 16b: the device's workouts on a day with no session made one, "From WHOOP"; how many depends on the member's clock against the mock's UTC dates.
    const fromWhoop = ((own.body_sessions ?? []) as { routineName: string | null }[]).filter((s) => s.routineName === "From WHOOP").length;
    if ((own.body_sets ?? []).length !== 6 || (own.body_exercises ?? []).length !== 3 || (own.body_routines ?? []).length !== 2 || fromWhoop > 2 || (own.body_sessions ?? []).length !== 2 + fromWhoop) throw new Error(`the member's Body export has their workouts (${(own.body_sessions ?? []).length} sessions, ${fromWhoop} from WHOOP; B9 added Coach row and Coach push day)`);
    if (!(own.body_pantry ?? []).length || (own.body_yields ?? []).length !== 1) throw new Error("the member's Body export has their pantry and weighings");
    if ((own.body_habits ?? []).length !== 4 || !(own.body_habit_logs ?? []).length || (own.body_health ?? []).length !== 1) throw new Error("the member's Body export has their habits (the Sauna one WHOOP ticks among them), their logs and their health log");
    if ((own.body_plan ?? []).length !== 1 || (own.body_orders ?? []).length !== 0) throw new Error("the member's Body export has this week's plan, and no pushes while Instacart is closed");
    if ((own.body_activities ?? []).length !== 5 || (own.body_devices ?? []).length !== 0 || JSON.stringify(own).includes("enc:v1:") || JSON.stringify(own).includes("whoop-access")) throw new Error("the member's Body export has the device's workouts and never a token");
    if ((own.body_entries ?? []).length !== 6 || (own.body_foods ?? []).length !== FOODS.length || !own.body_settings?.length || Object.keys(own).some((k) => k === "leads" || k === "tasks")) throw new Error("the member's Body export has their Body data and only that");
    // ── The Airtable history (B5, rev 237 phase 7): the synthetic HumanOS base through the page. The dry run's numbers are the
    // mapper's own; Approve writes them; a second run finds everything already in; the mock saw GETs alone and never the
    // Password Bank; the token never comes back in a response. ──
    const { HUMANOS_BASE, HUMANOS_TABLES, HUMANOS_TOKEN } = await import("./fixtures/airtable-humanos");
    const { buildHistoryPlan, historySummary, readingIdFor } = await import("@/lib/engine/body-airtable");
    const { tableKey } = await import("@/lib/engine/airtable-import");
    const { spawn } = await import("node:child_process");
    const mockPort = 4070;
    const mock = spawn("npx", ["tsx", "scripts/mock-airtable.ts", String(mockPort)], { stdio: "ignore", detached: true });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          await fetch(`http://localhost:${mockPort}/__methods`);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      const fixture = Object.fromEntries(HUMANOS_TABLES.map((t) => [tableKey(t.name), t.records]));
      const lc = (x: string) => x.trim().toLowerCase();
      const existing = {
        exercises: new Map((await db.query.bodyExercises.findMany({ where: eq(schema.bodyExercises.userId, maya.id) })).filter((e) => !e.archivedAt).map((e) => [lc(e.name), e.id])),
        routines: new Set((await db.query.bodyRoutines.findMany({ where: eq(schema.bodyRoutines.userId, maya.id) })).map((r) => lc(r.name))),
        sessionDates: new Set((await db.query.bodySessions.findMany({ where: eq(schema.bodySessions.userId, maya.id) })).map((x) => x.date)),
        readingIds: new Set<string>(),
      };
      const expected = historySummary(buildHistoryPlan({ journal: fixture.journal, exercises: fixture.exercises, routines: fixture.routines }, existing, { notes: true, from: null }));
      if (expected.weighIns !== 3 || expected.sessions !== 4 || expected.sets !== 14 || expected.skipped !== 1 || expected.unread !== 1 || expected.routines !== 2) throw new Error(`the fixture gives three weigh-ins, four workouts with fourteen sets, two routines, one carried-forward day and one unread line: ${JSON.stringify(expected)}`);
      const echoed: string[] = [];
      client.on("response", async (r) => {
        if (r.request().method() !== "POST") return;
        if ((await r.text().catch(() => "")).includes(HUMANOS_TOKEN)) echoed.push(r.url());
      });
      const dryRun = async () => {
        await client.goto(`${base}/body/import`);
        await client.locator('[data-testid="history-base"]').waitFor({ timeout: 30000 });
        await fillExact(client, '[data-testid="history-base"]', HUMANOS_BASE);
        await fillExact(client, '[data-testid="history-token"]', HUMANOS_TOKEN);
        await press(client, '[data-testid="history-dry"]', async () => (await client.locator('[data-testid="history-preview"]').count()) > 0, "the dry run");
        return client.locator('[data-testid="history-preview"]');
      };
      // Rev 296: Maya logged her own sets, so "Day types only" is ticked by default; the full run below unticks it first.
      await client.goto(`${base}/body/import`);
      await client.locator('[data-testid="history-day-types"]').waitFor({ timeout: 30000 });
      if (!(await client.locator('[data-testid="history-day-types"]').isChecked())) throw new Error("a member with their own history sees Day types only ticked");
      const dryRunFull = dryRun;
      const dryRun2 = async (dayTypesOnly: boolean) => {
        await client.goto(`${base}/body/import`);
        await client.locator('[data-testid="history-base"]').waitFor({ timeout: 30000 });
        if ((await client.locator('[data-testid="history-day-types"]').isChecked()) !== dayTypesOnly) await client.locator('[data-testid="history-day-types"]').click();
        await fillExact(client, '[data-testid="history-base"]', HUMANOS_BASE);
        await fillExact(client, '[data-testid="history-token"]', HUMANOS_TOKEN);
        await press(client, '[data-testid="history-dry"]', async () => (await client.locator('[data-testid="history-preview"]').count()) > 0, "the dry run");
        return client.locator('[data-testid="history-preview"]');
      };
      void dryRunFull;
      const pv = await dryRun2(false);
      for (const [attr, want] of [["data-weigh-ins", expected.weighIns], ["data-sessions", expected.sessions], ["data-sets", expected.sets], ["data-exercises", expected.exercises], ["data-routines", expected.routines], ["data-skipped", expected.skipped]] as const) if ((await pv.getAttribute(attr)) !== String(want)) throw new Error(`the dry run's ${attr} is the mapper's (${want}), got ${await pv.getAttribute(attr)}`);
      if ((await client.locator('[data-testid="history-session"]').count()) !== 4 || (await client.locator('[data-testid="history-session"][data-date="2026-09-26"]').textContent())?.includes("read from the notes") !== true || (await client.locator('[data-testid="history-session"][data-date="2026-04-10"]').count())) throw new Error("the dry run lists each day and says where its sets came from; the Off Day drafts never appear");
      if ((await client.locator('[data-testid="history-exercises"]').textContent())?.includes("Skullcrushers") !== true) throw new Error("a shouted exercise name comes over in title case");
      await noSideScroll(client, "/body/import with a dry run");
      await press(client, '[data-testid="history-approve"]', async () => /\/body\/import\?done=/.test(client.url()), "the import done");
      await client.locator('[data-testid="history-done"]').waitFor({ timeout: 30000 });
      const daily = await db.query.bodyDaily.findMany({ where: and(eq(schema.bodyDaily.userId, maya.id), eq(schema.bodyDaily.source, "airtable")) });
      const readings = new Set(daily.map((d) => d.readingId));
      if (readings.size !== 3 || readings.has(readingIdFor("recHW00000000004"))) throw new Error(`three weigh-ins land, the carried-forward day never: ${[...readings].join(", ")}`);
      const at = (rec: string, key: string) => daily.find((d) => d.readingId === readingIdFor(rec) && d.key === key)?.value;
      if (at("recHW00000000002", "weight") !== 170.6 || at("recHW00000000002", "bf") !== 21.9) throw new Error("on a day with two generations the newer wins");
      if (at("recHW00000000001", "bf") !== 22.3 || at("recHW00000000001", "smm_pct") !== 49.8) throw new Error("the oldest generation's fractions land as percents");
      const imported = await db.query.bodySessions.findMany({ where: and(eq(schema.bodySessions.userId, maya.id), inArray(schema.bodySessions.date, ["2026-03-30", "2026-04-10", "2026-04-12", "2026-04-15", "2026-09-26"])) });
      const legDay = await db.query.bodyRoutines.findFirst({ where: and(eq(schema.bodyRoutines.userId, maya.id), eq(schema.bodyRoutines.name, "Leg Day")) });
      if (!legDay || legDay.items.length !== 2) throw new Error("the routine lands with its two exercises");
      const sept = imported.find((x) => x.date === "2026-09-26");
      if (imported.length !== 4 || imported.some((x) => !x.completedAt || x.note !== "From Airtable") || sept?.routineName !== "Leg Day" || sept.routineId !== legDay.id) throw new Error("the four days land as finished workouts marked From Airtable, the September day linked to its routine; the Off Day draft never");
      const setsOn = async (date: string) => (await db.query.bodySets.findMany({ where: and(eq(schema.bodySets.userId, maya.id), eq(schema.bodySets.date, date)) })).length;
      if ((await setsOn("2026-04-12")) !== 4 || (await setsOn("2026-09-26")) !== 5 || (await setsOn("2026-04-15")) !== 3 || (await setsOn("2026-03-30")) !== 2 || (await setsOn("2026-04-10")) !== 0) throw new Error("the rows give the spring day four sets, the chest row lands on 15 Apr only, the twice-entered day once from its notes' working sets, the Off Day drafts never; the notes give the autumn day its five");
      await client.goto(`${base}/body/training?date=2026-09-26`);
      await client.locator('[data-testid="training-exercise"]').first().waitFor({ timeout: 30000 });
      if ((await client.locator('[data-testid="training-set"]').count()) !== 5) throw new Error("Training shows the imported day's five sets");
      // Again: everything already in, so Approve has nothing to do.
      const again = await dryRun2(false);
      if ((await again.getAttribute("data-weigh-ins")) !== "0" || (await again.getAttribute("data-sessions")) !== "0" || (await again.getAttribute("data-exercises")) !== "0" || (await again.getAttribute("data-routines")) !== "0") throw new Error("a second run finds everything already in");
      if (!(await client.locator('[data-testid="history-approve"]').isDisabled())) throw new Error("with nothing new, Approve is shut");
      // Day types only: with a day type named like the Journal's routine, the plan names the days that take it and nothing else; Approve writes just those.
      const { newId: freshId } = await import("@/lib/ids");
      const legType = { id: freshId(), workspaceId: mem.workspaceId, userId: maya.id, name: "Leg Day", order: 9 };
      await db.insert(schema.bodyDayTypes).values(legType);
      const onlyDays = await dryRun2(true);
      const daysPlanned = Number(await onlyDays.getAttribute("data-days"));
      if (!(daysPlanned > 0) || (await onlyDays.getAttribute("data-sessions")) !== "0" || (await onlyDays.getAttribute("data-weigh-ins")) !== "0" || (await onlyDays.getAttribute("data-exercises")) !== "0") throw new Error(`day types only plans days and nothing else: ${daysPlanned} days`);
      const setsBeforeDays = (await db.query.bodySets.findMany({ where: mine(schema.bodySets) })).length;
      await press(client, '[data-testid="history-approve"]', async () => new RegExp(`done=${daysPlanned}\\b`).test(client.url()), "day types written");
      if ((await db.query.bodySets.findMany({ where: mine(schema.bodySets) })).length !== setsBeforeDays) throw new Error("day types only writes no sets");
      const legDays = await db.query.bodyDays.findMany({ where: and(mine(schema.bodyDays), eq(schema.bodyDays.dayTypeId, legType.id)) });
      if (legDays.length !== daysPlanned || !legDays.some((d) => d.date === "2026-09-26")) throw new Error(`the Leg Day sessions take the Leg Day day type: ${legDays.length} of ${daysPlanned}`);
      // Back out the day type and its days, so the rest of the walk sees the library it built.
      await db.delete(schema.bodyDays).where(and(mine(schema.bodyDays), eq(schema.bodyDays.dayTypeId, legType.id)));
      await db.delete(schema.bodyDayTypes).where(eq(schema.bodyDayTypes.id, legType.id));
      const { methods, paths } = (await (await fetch(`http://localhost:${mockPort}/__methods`)).json()) as { methods: string[]; paths: string[] };
      if (methods.some((m) => m !== "GET")) throw new Error(`the import only reads: ${methods.join(",")}`);
      if (paths.some((x) => x.includes("tblHPASSWORDS001"))) throw new Error("the import never asks for the Password Bank's rows");
      if (!paths.some((x) => x.includes("tblHJOURNAL00001"))) throw new Error("the import read the Journal");
      if (echoed.length) throw new Error(`the token never comes back in a response: ${echoed.join(", ")}`);
      console.log("✓ Airtable history: the dry run's numbers are the mapper's; three weigh-ins (the newer generation winning a shared day, fractions as percents, a carried-forward day left out), four workouts (rows, a row's working-set notes, the day's notes) with fourteen sets marked From Airtable, a chest row on 15 Apr only, a twice-entered day once, the Off Day drafts never, two routines and eight exercises; a second run finds it all already in; the mock saw GETs alone, never the Password Bank; the token never came back");
      // ── The coach's backfill (rev 441): past monthly feedback and Office Hours requests from the synthetic Omnichannel base. The
      // dry run's numbers are the engine's against what the workspace holds; Approve writes them, dated when they were sent; a
      // second run finds them all in; the members table gave the emails alone; the Password Bank was never asked for. ──
      {
        const { OMNI_BASE, OMNI_TABLES, OMNI_TOKEN } = await import("./fixtures/airtable-omni");
        const { buildBackfill, backfillSummary, MEMBER_EMAIL_FIELD } = await import("@/lib/engine/coach-backfill");
        const { existingBackfill, workspaceMembers } = await import("@/lib/coach-backfill");
        const ws = mem.workspaceId;
        const byName = (n: string) => OMNI_TABLES.find((t) => t.name.includes(n))!.records;
        const plan = buildBackfill(
          { feedback: byName("Client Feedback"), support: byName("Client Support"), emails: new Map(byName("Fulfillment").map((r) => [r.id, String(r.fields[MEMBER_EMAIL_FIELD])])) },
          await workspaceMembers(ws),
          await existingBackfill(ws),
        );
        const want = backfillSummary(plan);
        const feedbackBefore = new Set((await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, ws), columns: { id: true } })).map((r) => r.id));
        const leaked: string[] = [];
        coach.on("response", async (r) => {
          if (r.request().method() !== "POST") return;
          if ((await r.text().catch(() => "")).includes(OMNI_TOKEN)) leaked.push(r.url());
        });
        const backfillDry = async () => {
          await coach.goto(`${base}/coach/backfill`);
          await coach.locator('[data-testid="backfill-token"]').waitFor({ timeout: 30000 });
          await fillExact(coach, '[data-testid="backfill-base"]', OMNI_BASE);
          await fillExact(coach, '[data-testid="backfill-token"]', OMNI_TOKEN);
          await press(coach, '[data-testid="backfill-dry"]', async () => (await coach.locator('[data-testid="backfill-preview"]').count()) > 0, "the backfill dry run");
          return coach.locator('[data-testid="backfill-preview"]');
        };
        const pv = await backfillDry();
        for (const [attr, n] of [["data-feedback", want.feedbackNew], ["data-feedback-already", want.feedbackAlready], ["data-ooh", want.oohNew], ["data-skipped", want.skipped]] as const)
          if ((await pv.getAttribute(attr)) !== String(n)) throw new Error(`the backfill dry run's ${attr} is the engine's ${n}: ${await pv.getAttribute(attr)}`);
        if (want.oohNew !== 2 || want.skipped < 3 || !(await coach.locator('[data-testid="backfill-skip"][data-why="No HelixOS member has this row\'s email."]').count())) throw new Error(`two requests land and the unplaced rows are listed with why: ${JSON.stringify(want)}`);
        await noSideScroll(coach, "/coach/backfill with a dry run");
        await press(coach, '[data-testid="backfill-approve"]', async () => /\/coach\/backfill\?done=/.test(coach.url()), "the backfill done");
        const ooh = await db.query.officeHoursRequests.findMany({ where: and(eq(schema.officeHoursRequests.workspaceId, ws), inArray(schema.officeHoursRequests.airtableId, ["recOOH0000000001", "recOOH0000000002"])) });
        const opt = ooh.find((o) => o.airtableId === "recOOH0000000001");
        const old = ooh.find((o) => o.airtableId === "recOOH0000000002");
        if (opt?.userId !== maya.id || opt.friday !== "2026-03-13" || opt.category !== "Funnels" || opt.outcome !== "covered" || opt.tools !== "GoHighLevel" || opt.createdAt !== "2026-03-10 15:00:00") throw new Error(`today's form lands on Maya, as written: ${JSON.stringify(opt)}`);
        if (old?.description !== "Two offers, one audience" || old.goal !== "How do I price two offers?" || old.outcome !== "no_show" || old.friday !== "2023-12-04") throw new Error(`the older form maps by its own questions: ${JSON.stringify(old)}`);
        const fresh = (await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, ws) })).filter((r) => !feedbackBefore.has(r.id));
        const feb = fresh.find((r) => r.userId === maya.id && r.month === "2026-02");
        if (fresh.length !== want.feedbackNew || (want.feedbackNew && feb && (feb.proud !== "Proud 1" || feb.referralScore !== 9 || feb.createdAt !== "2026-02-27 12:00:00" || feb.updatedAt !== feb.createdAt))) throw new Error(`the feedback lands as written, dated when sent: ${JSON.stringify(fresh.map((r) => [r.month, r.proud, r.createdAt, r.updatedAt]))}`);
        // Again: nothing new, so Approve is shut.
        const again = await backfillDry();
        if ((await again.getAttribute("data-feedback")) !== "0" || (await again.getAttribute("data-ooh")) !== "0" || !(await coach.locator('[data-testid="backfill-approve"]').isDisabled())) throw new Error("a second run finds everything already in");
        const { paths: omniPaths } = (await (await fetch(`http://localhost:${mockPort}/__methods`)).json()) as { methods: string[]; paths: string[] };
        const fulfillment = omniPaths.filter((x) => x.includes("tblxCBKthZ4EmmV6Y"));
        if (!fulfillment.length || fulfillment.some((x) => !x.endsWith(`?fields=${MEMBER_EMAIL_FIELD}`))) throw new Error(`the members table is asked for its email field alone: ${fulfillment.join(", ")}`);
        if (omniPaths.some((x) => x.includes("tblOPASSWORDS0001"))) throw new Error("the backfill never asks for the Password Bank's rows");
        if (leaked.length) throw new Error(`the token never comes back in a response: ${leaked.join(", ")}`);
        console.log(`✓ coach backfill (rev 441): the dry run's numbers are the engine's (${want.feedbackNew} feedback months, ${want.oohNew} Office Hours requests, ${want.skipped} left out with why); Approve lands them as written, dated when sent; a second run finds them all in; the members table gave its emails alone and the Password Bank was never asked for`);
        // Back out what landed, so the rest of the walk sees the workspace it built.
        await db.delete(schema.officeHoursRequests).where(and(eq(schema.officeHoursRequests.workspaceId, ws), inArray(schema.officeHoursRequests.airtableId, ["recOOH0000000001", "recOOH0000000002"])));
        if (fresh.length) await db.delete(schema.monthlyFeedback).where(inArray(schema.monthlyFeedback.id, fresh.map((r) => r.id)));
      }
    } finally {
      if (mock.pid) process.kill(-mock.pid);
    }
    await client.goto(`${base}/body/settings`);
    await client.locator("#download").waitFor({ timeout: 30000 });

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

    // ── The HumanOS switch (rev 320/322): the member's own, from Settings; the coach's path only with working access; both logged. ──
    const humanosEvents = async () => (await db.query.bodyShareEvents.findMany({ where: and(mine(schema.bodyShareEvents), eq(schema.bodyShareEvents.kind, "humanos")) })).map((e) => (e.shared ? "on" : "off"));
    const foodsBefore = (await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).length;
    await client.goto(`${base}/settings`);
    await press(client, '[data-testid="humanos-toggle"]', async () => /: Off/.test(await client.locator('[data-testid="humanos-state"]').innerText()), "HumanOS off from Settings");
    if ((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) }))!.bodyEnabled) throw new Error("the member's switch sets their own membership");
    if ((await db.query.bodyFoods.findMany({ where: mine(schema.bodyFoods) })).length !== foodsBefore) throw new Error("turning HumanOS off keeps every row");
    await notFoundPage(client, "/body");
    await client.goto(`${base}/more`);
    await client.locator('main a[href="/today"]').waitFor({ timeout: 30000 });
    if ((await client.locator('main a[href="/body"]').count()) || !(await client.locator('main a[href="/settings#humanos"]').count())) throw new Error("with HumanOS off, the menu has no HumanOS pages and one 'Turn on HumanOS' entry");
    // The coach's path: nothing on the roster while the client's working access is off; the control once it's on; the switch turns it on and shares nothing.
    const coachUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    await db.update(schema.memberships).set({ coachCanWork: false }).where(eq(schema.memberships.id, mem.id));
    await coach.goto(`${base}/coach`);
    await coach.locator('[data-testid="coach-body-cell"]').first().waitFor({ timeout: 30000 });
    if (await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"] [data-testid="coach-humanos-on"]`).count()) throw new Error("no coach control without the client's working access");
    await db.update(schema.memberships).set({ coachCanWork: true }).where(eq(schema.memberships.id, mem.id));
    await coach.goto(`${base}/coach`);
    await press(coach, `[data-testid="coach-body-cell"][data-member="${mem.id}"] [data-testid="coach-humanos-on"]`, async () => !!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mem.id) }))!.bodyEnabled, "the coach turned HumanOS on");
    // The refreshed roster lands a beat after the action: wait for the control to go, then read the cell.
    await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"] [data-testid="coach-humanos-on"]`).waitFor({ state: "detached", timeout: 30000 });
    if ((await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"]`).innerText()).trim() !== "") throw new Error("turning HumanOS on for a client shares nothing: the cell stays blank until they share");
    // Delete-all above removed the settings row; whatever is there, neither consent switch is on after the coach's switch.
    const settingsNow = await db.query.bodySettings.findFirst({ where: mine(schema.bodySettings) });
    if (settingsNow && (settingsNow.shareWithCoach || settingsNow.aiUse)) throw new Error("the two consent switches stay where the member left them");
    await client.goto(`${base}/settings`);
    if (!/: On/.test(await client.locator('[data-testid="humanos-state"]').innerText())) throw new Error("the member's Settings card says On after the coach's switch");
    await client.goto(`${base}/body`);
    await client.locator('[data-testid="body-start"], [data-testid="body-tiles"]').first().waitFor({ timeout: 30000 });
    const loggedHumanos = await humanosEvents();
    if (JSON.stringify(loggedHumanos) !== JSON.stringify(["off", "on"])) throw new Error(`both switches are logged as kind humanos: ${JSON.stringify(loggedHumanos)}`);
    const accountEvents = (await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, maya.id), eq(schema.syncEvents.provider, "account")) })).filter((e) => e.event.startsWith("humanos.")).map((e) => e.event).sort();
    if (JSON.stringify(accountEvents) !== JSON.stringify(["humanos.off", "humanos.on"])) throw new Error(`the account log has both: ${JSON.stringify(accountEvents)}`);
    if ((await coach.locator(`[data-testid="coach-body-cell"][data-member="${mem.id}"] [data-testid="coach-humanos-on"]`).count())) throw new Error("no coach control once HumanOS is on");
    void coachUser;
    console.log("✓ the HumanOS switch: the member turned it off from Settings (rows kept, pages not found, one menu entry back to the switch); the coach's control appeared only with working access and turned it on, sharing nothing; both logged");

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
