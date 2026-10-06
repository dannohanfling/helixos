/**
 * End-to-end smoke walk through the demo workspace. Run with the dev server up:
 *   npx tsx scripts/smoke.ts [baseUrl]
 * Captures screenshots into ./screenshots and fails loudly on any 500 or missing text.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // A page answers at once with its loading skeleton and the content lands a moment later; wait for that, then the text.
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected to see "${text}" on ${page.url()}`);
  });
}

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("pageerror", (e) => {
    console.log(`  [pageerror] ${e.message.slice(0, 200)}`);
    failures.push(`pageerror: ${e.message}`);
  });

  // A fresh morning (rev 377, rev 418): two of yesterday's Top 3 still open, one due today and one due in two days. Today
  // demotes both (no star's urgency; "today" only for the one due today) and offers them first, unticked.
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { addDays, todayInTz } = await import("@/lib/dates");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mayaM.workspaceId) }))!;
  const mayaToday = todayInTz(mayaM.timezone || ws.timezone);
  const CARRIED = { dueToday: "Smoke carried due today", dueLater: "Smoke carried due later" };
  await db.delete(schema.tasks).where(and(eq(schema.tasks.userId, maya.id), inArray(schema.tasks.title, Object.values(CARRIED))));
  for (const [title, dueDate] of [[CARRIED.dueToday, mayaToday], [CARRIED.dueLater, addDays(mayaToday, 2)]] as const) {
    await db.insert(schema.tasks).values({ id: newId(), workspaceId: ws.id, userId: maya.id, title, category: "content", urgency: "top3", status: "today", dueDate, focusDate: addDays(mayaToday, -1), points: 20 });
  }

  // Login
  await page.goto(`${base}/login`);
  await expectText(page, "Welcome back", "login");
  await shot(page, "00-login");
  await page.fill('input[name="email"]', "client@demo.helixos.app");
  await page.fill('input[name="password"]', "demo1234");
  await page.click('button[type="submit"]:has-text("Sign in")');
  await page.waitForURL(/\/today/);
  await expectText(page, "Next best action", "today");
  await shot(page, "01-today-before-lockin");

  // Morning lock-in (expand the form if today is already locked in)
  const redo = page.locator('summary:has-text("Edit lock-in")');
  if (await redo.isVisible()) await redo.click();
  // The layout (rev 531): before lock-in the lock-in is the hero at the content's full width; titles are whole, energy labels fit.
  if (!(await redo.count())) {
    const hero = page.locator('[data-testid="lockin-hero"]');
    const heroBox = (await hero.boundingBox())!;
    const thenBox = (await page.locator("text=Then").first().boundingBox())!;
    if (heroBox.width < 600 || thenBox.y < heroBox.y + heroBox.height) throw new Error(`the lock-in is the hero, full width, with Then below it: ${JSON.stringify({ heroBox, thenBox })}`);
    if (await page.locator('[data-testid="lockin-summary"]').count()) throw new Error("no lock-in summary before the lock-in");
    const fits = async (sel: string) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    const spill = await fits('[data-testid="energy-segment"]');
    if (spill.length) throw new Error(`every energy label fits its segment: ${spill.join(", ")}`);
    const titleRows = await page.locator('[data-testid="top3-item"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    if (titleRows.some((w) => w < 400)) throw new Error(`the top 3 is one column of full-width rows: ${titleRows.join(", ")}`);
    if (!/of 3 picked/.test(await page.locator('[data-testid="top3-count"]').innerText())) throw new Error("the picker counts the picks");
    console.log(`✓ Today before lock-in: the lock-in is the hero (${Math.round(heroBox.width)}px), the top 3 one column of whole titles, energy labels fit, "n of 3 picked"`);
  }
  await page.locator('label:has(input[name="energy"][value="4"])').click();
  await page.fill('input[name="intention"]', "Three real conversations before noon.");
  // Several new tasks before locking in (rev 157): Add or Enter puts each in the list, ticked up to three, and clears the box.
  const picker = page.locator('[data-testid="top3-picker"]');
  if ((await picker.locator('[data-testid="top3-carried-label"]').innerText()).trim() !== "Still open from yesterday") throw new Error("yesterday's unfinished Top 3 comes first, under its own line");
  for (const t of Object.values(CARRIED)) {
    if ((await picker.locator('[data-testid="top3-carried"] [data-testid="top3-item"]', { hasText: t }).locator("input").isChecked()) !== false) throw new Error(`${t}: offered first and unticked`);
  }
  const carriedRows = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), inArray(schema.tasks.title, Object.values(CARRIED))) });
  const byTitle = new Map(carriedRows.map((t) => [t.title, t]));
  if (byTitle.get(CARRIED.dueToday)?.urgency !== "high" || byTitle.get(CARRIED.dueToday)?.status !== "today") throw new Error(`the one due today loses the star and stays today: ${JSON.stringify(byTitle.get(CARRIED.dueToday))}`);
  if (byTitle.get(CARRIED.dueLater)?.urgency !== "high" || byTitle.get(CARRIED.dueLater)?.status !== "upcoming") throw new Error(`the one due later loses the star and goes back to upcoming: ${JSON.stringify(byTitle.get(CARRIED.dueLater))}`);
  console.log("✓ fresh morning: yesterday's unfinished Top 3 demoted (high; today only if due today) and offered first, unticked, under \"Still open from yesterday\"");
  while (await picker.locator('input[name="focus"]:checked').count()) await picker.locator('input[name="focus"]:checked').first().uncheck();
  const NEW_TASKS = ["Smoke focus task", "Smoke task two", "Smoke task three", "Smoke task four"];
  for (const [i, t] of NEW_TASKS.entries()) {
    await page.fill('[data-testid="top3-new"]', t);
    if (i % 2) await page.click('[data-testid="top3-add"]');
    else await page.press('[data-testid="top3-new"]', "Enter");
    await picker.locator('[data-testid="top3-item"]', { hasText: t }).waitFor({ timeout: 15000 });
    if ((await page.inputValue('[data-testid="top3-new"]')) !== "") throw new Error("adding clears the box for the next one");
  }
  const tickedTitles = await picker.locator('[data-testid="top3-item"]:has(input:checked)').allInnerTexts();
  if (tickedTitles.length !== 3 || tickedTitles.some((t) => t.includes("Smoke task four")) || !(await page.locator('[data-testid="top3-note"]').innerText()).includes("You've picked 3. Untick one to swap.")) throw new Error(`three are ticked, the fourth goes in unticked with a quiet line: ${tickedTitles.join(" | ")}`);
  if (!(await page.locator('[data-testid="top3-note"]').innerText()).includes("Task added ✓")) throw new Error("adding a task on Today confirms it in green");
  await picker.locator('[data-testid="top3-item"]', { hasText: "Smoke task four" }).locator('[data-testid="top3-remove"]').click();
  await picker.locator('[data-testid="top3-item"]', { hasText: "Smoke task four" }).waitFor({ state: "detached", timeout: 15000 });
  await submit(page, 'button:has-text("Lock it in")');
  await expectText(page, "Done · +10", "lock-in done");
  for (const t of NEW_TASKS.slice(0, 3)) await page.locator('[data-testid="task-row"]', { hasText: t }).first().waitFor({ timeout: 15000 });
  if (await page.locator('[data-testid="task-row"]', { hasText: "Smoke task four" }).count()) throw new Error("a task taken back before the lock-in is gone");
  if (await page.locator('#checkin [data-testid="task-row"] [data-testid="task-category"]').count()) throw new Error("the Top 3 rows carry no category");
  if (!(await page.locator('[data-testid="task-row"]', { hasText: CARRIED.dueToday }).locator('[data-testid="task-category"]').count())) throw new Error("the board's rows keep their category");
  console.log("✓ lock-in: four tasks added (Add and Enter), three ticked, the fourth unticked with a quiet line, one taken back, three locked in");
  // After lock-in: the hero is gone, a compact summary holds the picks with Edit, and the 30-day build sits under it.
  if (await page.locator('[data-testid="lockin-hero"]').count()) throw new Error("after lock-in the hero no longer holds the form");
  if (!(await page.locator('[data-testid="lockin-summary"] summary:has-text("Edit lock-in")').count())) throw new Error("the summary offers Edit");
  // At phone width the page is one column and nothing runs off the side.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflowX > 1) throw new Error(`Today fits a phone's width: ${overflowX}px over`);
  await page.setViewportSize({ width: 1280, height: 900 });
  console.log("✓ Today after lock-in: a compact summary with Edit, no hero form; one column at 375px with nothing off the side");
  const errors = await page.locator("nextjs-portal").count();
  console.log(`dev overlay portals: ${errors}`);
  await shot(page, "02-today-locked-in");

  // Complete a focus task
  const before = await page.locator("text=/\\d+\\/\\d+ done/").first().textContent();
  await submit(page, '[data-testid="task-row"]:has-text("Smoke focus task") [data-testid="task-toggle"]');
  const after = await page.locator("text=/\\d+\\/\\d+ done/").first().textContent();
  if (before === after) throw new Error(`task completion did not change counter (${before} -> ${after})`);
  console.log(`✓ task toggled (${before?.trim()} -> ${after?.trim()})`);

  // Evening close (expand if already closed today)
  const editClose = page.locator('summary:has-text("Edit today")');
  if (await editClose.isVisible()) await editClose.click();
  const early = page.locator('[data-testid="close-early"] > summary');
  if (await early.isVisible()) await early.click();
  await page.fill('input[name="dmsStarted"]', "3");
  await page.fill('input[name="callsBooked"]', "1");
  await page.fill('input[name="win"]', "Booked a call from a cold DM.");
  // Rev 444: cash the way people write it. One that can't be read says so before Save and is refused beside its box, everything
  // else kept; "1.2k" is saved as 1200, never 1.2.
  await page.fill('[data-testid="close-cashCollected"]', "about a grand");
  if ((await page.locator('[data-testid="close-form"] [data-testid="money-read"]').first().innerText()).trim() !== "Write the amount as a number, like 3500.") throw new Error("an amount it can't read says so under the box before Save");
  await submit(page, 'button:has-text("Close the day")');
  await page.locator('[data-testid="close-error"]').waitFor({ timeout: 15000 });
  if ((await page.inputValue('input[name="win"]')) !== "Booked a call from a cold DM." || (await page.inputValue('input[name="dmsStarted"]')) !== "3" || (await page.inputValue('[data-testid="close-cashCollected"]')) !== "about a grand") throw new Error("a refused close keeps every box as typed");
  if ((await page.locator('[data-testid="close-cashCollected"]').getAttribute("aria-invalid")) !== "true") throw new Error("the cash box is the one marked");
  await page.fill('[data-testid="close-cashCollected"]', "1.2k");
  if ((await page.locator('[data-testid="close-form"] [data-testid="money-read"]').first().innerText()).trim() !== "Reads as $1,200") throw new Error("the box says what it understood before Save");
  await submit(page, 'button:has-text("Close the day")');
  await expectText(page, "Day closed", "close");
  {
    const { todayInTz } = await import("@/lib/dates");
    const closedLog = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, maya.id), eq(schema.dailyLogs.date, todayInTz(mayaM.timezone || ws.timezone))) });
    if (closedLog?.cashCollected !== 1200) throw new Error(`"1.2k" is saved as 1200: ${closedLog?.cashCollected}`);
  }
  console.log("✓ rev 444: the close reads \"1.2k\" as $1,200 before Save and saves 1200; an amount it can't read is refused beside its box, everything else kept");
  await shot(page, "03-today-closed");

  // Tasks
  await page.goto(`${base}/tasks`);
  await expectText(page, "Top 3 today", "tasks");
  await page.click('summary:has-text("+ New task")');
  await page.fill('input[name="title"]', "Smoke-test task");
  await submit(page, 'button:has-text("Add task")');
  await expectText(page, "Smoke-test task", "tasks create");
  await shot(page, "04-tasks");

  // Content
  await page.goto(`${base}/content`);
  await expectText(page, "Ideas", "content board");
  await shot(page, "05-content-board");
  await page.goto(`${base}/content?view=calendar`);
  await expectText(page, "This week", "content calendar");
  await shot(page, "06-content-calendar");
  await page.goto(`${base}/content?view=posted`);
  await expectText(page, "Client win", "content posted");

  // Conversations
  await page.goto(`${base}/conversations`);
  await expectText(page, "Priya Natarajan", "conversations");
  await shot(page, "07-conversations");
  await page.click('a:has-text("Priya Natarajan")');
  await page.waitForURL(/\/conversations\//);
  await expectText(page, "Thread", "contact");
  await page.check('input[name="direction"][value="in"]');
  await page.fill('textarea[name="body"]', "10am works for me!");
  await submit(page, 'button:has-text("Log it")');
  await expectText(page, "10am works for me!", "log message");
  await shot(page, "08-contact");
  await page.goto(`${base}/conversations/playbook`);
  await expectText(page, "Proactive Outreach", "playbook");
  await shot(page, "09-playbook");

  // Pathway
  await page.goto(`${base}/pathway`);
  await expectText(page, "Your pathway", "pathway");
  await page.locator('a[href^="/pathway?task="]').first().click();
  await page.waitForLoadState("networkidle");
  await expectText(page, "How to complete", "pathway task");
  await shot(page, "10-pathway");

  // Numbers, rewards, settings
  await page.goto(`${base}/numbers`);
  await expectText(page, "last 12 weeks", "numbers");
  await expectText(page, "Revenue by pillar", "revenue by pillar");
  if ((await page.locator('[data-testid="pillars"] > div').count()) !== 3) throw new Error("expected three pillar cards");
  await shot(page, "11-numbers");
  await page.goto(`${base}/rewards`);
  await expectText(page, "The ladder", "rewards");
  await shot(page, "12-rewards");
  await page.goto(`${base}/settings`);
  await expectText(page, "Your one goal", "settings");
  // A save on Settings confirms in green, near the button (rev 157).
  await submit(page, 'button:has-text("Save goal")');
  await page.locator('[data-testid="save-confirm"]').first().waitFor({ timeout: 15000 });
  if ((await page.locator('[data-testid="save-confirm"]').first().innerText()).trim() !== "Saved ✓") throw new Error("Save goal on Settings shows the green confirmation");
  console.log("✓ Settings: Save goal shows \"Saved ✓\" in green");

  // Mobile view of Today
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const mp = await mobile.newPage();
  await mp.goto(`${base}/login`);
  await mp.fill('input[name="email"]', "client@demo.helixos.app");
  await mp.fill('input[name="password"]', "demo1234");
  await mp.click('button[type="submit"]:has-text("Sign in")');
  await mp.waitForURL(/\/today/);
  await mp.screenshot({ path: "screenshots/13-mobile-today-dark.png", fullPage: false });
  console.log("✓ 13-mobile-today-dark");
  // Rev 334, no cut-off: a 120-character task title and a long key result render in full at phone width, wrapping, never clipped.
  const LONG_TITLE = "Follow up with the twelve leads from Tuesday's webinar who asked about the payment plan and send each the recording link";
  if (LONG_TITLE.length !== 120) throw new Error(`the walk's long title is ${LONG_TITLE.length} characters`);
  await mp.goto(`${base}/tasks`);
  await mp.click('summary:has-text("+ New task")');
  await mp.fill('input[name="title"]', LONG_TITLE);
  await Promise.all([mp.waitForResponse((r) => r.request().method() === "POST"), mp.locator('form:has(input[name="title"]) button[type="submit"]').first().click()]);
  await mp.goto(`${base}/today`);
  const longRow = mp.locator('[data-testid="task-row"]', { hasText: LONG_TITLE.slice(0, 40) }).first();
  await longRow.waitFor({ timeout: 15000 });
  const rowText = (await longRow.innerText()).replace(/\s+/g, " ");
  const clipped = await longRow.evaluate((el) => {
    const title = Array.from(el.querySelectorAll<HTMLElement>("div, span")).find((n) => (n.textContent ?? "").includes("payment plan") && n.children.length <= 1) ?? el;
    const cs = getComputedStyle(title);
    return { over: title.scrollWidth > title.clientWidth + 1, ellipsis: cs.textOverflow === "ellipsis" && cs.overflow === "hidden", lines: Math.round(title.getBoundingClientRect().height / parseFloat(cs.lineHeight || "16")) };
  });
  if (!rowText.includes(LONG_TITLE) || clipped.over || clipped.ellipsis || clipped.lines < 2) throw new Error(`a 120-character task title renders in full at 390 px, wrapping: ${JSON.stringify(clipped)}`);
  const LONG_KR = "Book 12 discovery calls with people who watched the whole replay and asked a question in the group this week";
  await mp.goto(`${base}/intentions`);
  if (await mp.locator('[data-testid="week-edit"]').count()) await mp.click('[data-testid="week-edit"]');
  await mp.fill('[data-testid="week-word"]', "Show up daily");
  await mp.fill('[data-testid="week-kr1"]', LONG_KR);
  await mp.fill('[data-testid="week-kr2"]', "20 replies to the replay DM");
  await mp.fill('[data-testid="week-initiative"]', "Launch the replay funnel");
  await mp.fill('[data-testid="week-task1"]', "Post once a day");
  await mp.fill('[data-testid="week-task2"]', "DM ten replay watchers");
  await Promise.all([mp.waitForResponse((r) => r.request().method() === "POST"), mp.click('[data-testid="week-save"]')]);
  const kr = mp.locator('[data-testid="week-key-result"]', { hasText: "discovery calls" }).first();
  await kr.waitFor({ timeout: 15000 });
  const krClipped = await kr.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth + 1, text: (el.textContent ?? "").replace(/\s+/g, " ") }));
  if (!krClipped.text.includes(LONG_KR) || krClipped.over) throw new Error(`a long key result renders in full at 390 px: ${JSON.stringify(krClipped)}`);
  console.log("✓ rev 334: a 120-character task title and a long key result render in full at phone width");
  await mobile.close();

  // Coach
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/coach`);
  await expectText(page, "Verify submissions", "coach");
  await shot(page, "14-coach");
  const verify = page.locator('button:has-text("Verify · award points")').first();
  if (await verify.isVisible()) {
    await submit(page, 'button:has-text("Verify · award points")');
    console.log("✓ verified a submission");
  }
  await page.goto(`${base}/settings`);
  await expectText(page, "Invite links", "coach settings");

  // Join flow
  await page.click('button:has-text("Log out")');
  await page.goto(`${base}/join/ACADEMY1`);
  await expectText(page, "Join Evolve Omega Academy", "join");
  const stamp = Date.now();
  // Sign-up (rev 387, rev 469): first and last name, the business name required, a confirmed password; a refusal keeps every box.
  if ((await page.locator('label:has(input[name="businessName"]) .label').innerText()).trim().toLowerCase() !== "business name") throw new Error("sign-up asks the business name, with no (optional)");
  await page.fill('input[name="firstName"]', "Smoke");
  await page.fill('input[name="lastName"]', "Tester");
  await page.fill('input[name="email"]', "client@demo.helixos.app");
  await page.fill('input[name="password"]', "password123");
  await page.fill('input[name="confirm"]', "password12");
  await page.locator('[data-testid="join-mismatch"]').waitFor({ timeout: 5000 });
  if (!(await page.locator('[data-testid="join-mismatch"]').innerText()).includes("The two passwords don't match.")) throw new Error("the mismatch is said under the second box as it is typed");
  await page.click('button:has-text("Join and start Day 1")');
  await page.waitForTimeout(500);
  if (!page.url().includes("/join/")) throw new Error("a mismatch is refused before anything is sent");
  await page.fill('input[name="confirm"]', "password123");
  await page.click('button:has-text("Join and start Day 1")');
  await page.waitForTimeout(500);
  if (!page.url().includes("/join/") || !(await page.locator('input[name="businessName"]').evaluate((el: HTMLInputElement) => el.validity.valueMissing))) throw new Error("an empty business name is refused before anything is sent");
  // The server says the same if the browser's check is ever skipped.
  await page.evaluate(() => {
    (document.querySelector('[data-testid="join-form"]') as HTMLFormElement).noValidate = true;
  });
  await page.click('button:has-text("Join and start Day 1")');
  await expectText(page, "Enter your business name.", "the server refuses an empty business name");
  if ((await page.inputValue('input[name="firstName"]')) !== "Smoke" || (await page.inputValue('input[name="password"]')) !== "password123") throw new Error("the business name refusal keeps the rest as typed");
  await page.evaluate(() => {
    (document.querySelector('[data-testid="join-form"]') as HTMLFormElement).noValidate = false;
  });
  await page.fill('input[name="businessName"]', "Smoke Test Coaching");
  await page.fill('input[name="confirm"]', "password12");
  await page.click('[data-testid="join-show-password"]');
  if ((await page.locator('input[name="password"]').getAttribute("type")) !== "text" || (await page.locator('input[name="confirm"]').getAttribute("type")) !== "text") throw new Error("Show shows both passwords");
  await page.fill('input[name="confirm"]', "password123");
  if (await page.locator('[data-testid="join-mismatch"]').count()) throw new Error("the line goes once the two match");
  // An email that has an account, with another password: refused, and nothing typed is lost.
  await page.click('button:has-text("Join and start Day 1")');
  await expectText(page, "An account with that email exists", "join refused for a used email");
  for (const [field, want] of [["firstName", "Smoke"], ["lastName", "Tester"], ["email", "client@demo.helixos.app"], ["password", "password123"], ["confirm", "password123"]] as const) {
    if ((await page.inputValue(`input[name="${field}"]`)) !== want) throw new Error(`a refusal keeps ${field} as typed`);
  }
  await page.fill('input[name="email"]', `smoke+${stamp}@example.com`);
  await page.click('button:has-text("Join and start Day 1")');
  await page.waitForURL(/\/today/);
  const joined = await db.query.users.findFirst({ where: eq(schema.users.email, `smoke+${stamp}@example.com`) });
  if (joined?.name !== "Smoke Tester") throw new Error(`first and last are kept as the one name: ${joined?.name}`);
  const joinedM = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, joined.id) });
  if (joinedM?.businessName !== "Smoke Test Coaching") throw new Error(`the business name lands where Settings reads it: ${joinedM?.businessName}`);
  await page.goto(`${base}/settings`);
  if ((await page.inputValue('input[name="businessName"]')) !== "Smoke Test Coaching") throw new Error("Settings shows the business name given at sign-up");
  await page.goto(`${base}/today`);
  console.log("✓ sign-up: first and last name kept as one, the business name required (browser and server) and shown on Settings, the mismatch said and refused before sending, Show for both, a refusal keeps every box");
  await expectText(page, "Lock in your day", "new client today");
  await shot(page, "15-new-client-day-one");

  // Cron
  const cron = await page.request.get(`${base}/api/cron/reminders?force=morning`, { headers: { Authorization: "Bearer change-me" } });
  console.log(`✓ cron ${cron.status()} ${(await cron.text()).slice(0, 120)}`);

  await browser.close();
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Smoke walk passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
