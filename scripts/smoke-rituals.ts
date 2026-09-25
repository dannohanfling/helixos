/**
 * The member rituals inside HelixOS (handoff rev 124), walked as members and their coach meet them.
 * 1. The weekly 3-1-3: "Set your week" on Today until it is set (one word, two or three key results, one initiative, two or three
 *    tasks); the tasks become this week's Tasks, due Friday; an edit renames, adds and removes them; Friday to Sunday the key
 *    results are marked done or not; the coach sees who has set it, who hasn't (under the quiet list from Tuesday), and each
 *    member's history.
 * 2. The Open Office Hours request: the two gates (going back saves nothing, the promise must be ticked), this month's upcoming
 *    Fridays only, the member's own list with a change until the Friday; the coach sees requests by Friday, sets who takes it,
 *    covered or no-show and notes the member never sees (nor their export), and edits the category and host lists.
 * Dates are the real ones: what depends on the weekday is asserted against the engine's own answer for the member's today.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { todayInTz } = await import("@/lib/dates");
  const { intentionPrompt, lateForWeek, tasksDueOn, weekOf } = await import("@/lib/engine/intentions");
  const { upcomingFridays } = await import("@/lib/engine/office-hours");
  const { newId } = await import("@/lib/ids");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mayaM.workspaceId) }))!;
  const jordanM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, jordan.id), eq(schema.memberships.workspaceId, ws.id)) }))!;
  for (const u of [maya.id, jordan.id]) {
    await db.delete(schema.weeklyIntentions).where(eq(schema.weeklyIntentions.userId, u));
    await db.delete(schema.tasks).where(and(eq(schema.tasks.userId, u), eq(schema.tasks.source, "intention")));
    await db.delete(schema.officeHoursRequests).where(eq(schema.officeHoursRequests.userId, u));
  }
  const mayaToday = todayInTz(mayaM.timezone || ws.timezone);
  const jordanToday = todayInTz(jordanM.timezone || ws.timezone);
  const week = weekOf(mayaToday);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };
    const signOut = async () => {
      await page.goto(`${base}/settings`);
      await page.click('button:has-text("Log out")');
      await page.waitForURL(/\/login/);
    };
    const card = page.locator('[data-testid="week-card"]');
    const fill = async (v: { word: string; kr: string[]; initiative: string; tasks: string[] }) => {
      await page.fill('[data-testid="week-form"] [data-testid="week-word"] >> nth=0', v.word);
      for (let i = 0; i < 3; i++) await page.locator(`[data-testid="week-kr${i + 1}"]`).last().fill(v.kr[i] ?? "");
      await page.locator('[data-testid="week-initiative"]').last().fill(v.initiative);
      for (let i = 0; i < 3; i++) await page.locator(`[data-testid="week-task${i + 1}"]`).last().fill(v.tasks[i] ?? "");
    };
    const intentionTasks = () => db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.source, "intention")), orderBy: [schema.tasks.createdAt] });

    // ── 1. The 3-1-3: set it on Today. ──
    await signIn("client");
    await page.goto(`${base}/today`);
    await card.waitFor({ timeout: 20000 });
    if ((await card.getAttribute("data-state")) !== "set" || !((await card.textContent()) ?? "").includes("Set your week")) throw new Error("with no 3-1-3 this week, Today asks to set it");
    // One word, and at least two key results and two tasks: a gap says so and saves nothing.
    await fill({ word: "two words", kr: ["Book 5 calls", "Post 5 times"], initiative: "Finish my webinar slides", tasks: ["Follow up with 10 leads", "Record 2 videos"] });
    await submit(page, '[data-testid="week-save"]');
    await card.waitFor();
    if ((await page.locator('[data-testid="week-error"]').innerText()).trim() !== "Your word is one word.") throw new Error("a two-word word is refused, plainly");
    if (await db.query.weeklyIntentions.findFirst({ where: eq(schema.weeklyIntentions.userId, maya.id) })) throw new Error("a refused form saves nothing");
    await fill({ word: "Consistent", kr: ["Book 5 calls", "Post 5 times", ""], initiative: "Finish my webinar slides", tasks: ["Follow up with 10 leads", "Record 2 videos", "Email my list"] });
    await submit(page, '[data-testid="week-save"]');
    await page.locator('[data-testid="week-saved"]').waitFor({ timeout: 20000 });
    const saved = (await db.query.weeklyIntentions.findFirst({ where: eq(schema.weeklyIntentions.userId, maya.id) }))!;
    if (saved.weekOf !== week || saved.word !== "Consistent" || saved.keyResults.length !== 2 || saved.tasks.length !== 3) throw new Error(`saved for this week, the blank third key result dropped, got ${JSON.stringify(saved)}`);
    const expectedState = intentionPrompt(mayaToday, { reviewedAt: null });
    if ((await card.getAttribute("data-state")) !== expectedState || (await page.locator('[data-testid="week-word-shown"]').innerText()).trim() !== "Consistent") throw new Error(`once set, Today shows the week (${expectedState})`);
    let tasks = await intentionTasks();
    if (tasks.length !== 3 || tasks.some((t) => t.dueDate !== tasksDueOn(mayaToday) || t.sourceRef !== week) || tasks.map((t) => t.title).join("|") !== "Follow up with 10 leads|Record 2 videos|Email my list") throw new Error(`the three tasks are this week's Tasks, due Friday, got ${JSON.stringify(tasks.map((t) => [t.title, t.dueDate]))}`);
    await page.goto(`${base}/tasks`);
    for (const t of tasks) await page.getByText(t.title, { exact: false }).first().waitFor({ timeout: 15000 });
    console.log(`✓ the 3-1-3 set on Today (one word, 2 key results, 1 initiative, 3 tasks); the tasks are on Tasks, due ${tasksDueOn(mayaToday)}; Today shows the week (${expectedState})`);

    // ── Edit: the first task renamed in place, the third taken off; a done task stays done. ──
    await db.update(schema.tasks).set({ status: "done" }).where(eq(schema.tasks.id, tasks[1].id));
    await page.goto(`${base}/today`);
    await card.waitFor();
    if ((await page.locator('[data-testid="week-task"][data-done="yes"]').count()) !== 1) throw new Error("a task ticked off on Tasks shows done on the week");
    await page.locator('[data-testid="week-edit"]').click();
    await fill({ word: "Consistent", kr: ["Book 5 calls", "Post 5 times", "Close 1 client"], initiative: "Finish my webinar slides", tasks: ["Follow up with 12 leads", "Record 2 videos", ""] });
    await submit(page, '[data-testid="week-save"]');
    await page.locator('[data-testid="week-saved"]').waitFor({ timeout: 20000 });
    const after = await intentionTasks();
    if (after.length !== 2 || after[0].id !== tasks[0].id || after[0].title !== "Follow up with 12 leads" || after[1].id !== tasks[1].id || after[1].status !== "done") throw new Error(`an edit renames in place, removes the one taken off and keeps a done one, got ${JSON.stringify(after.map((t) => [t.title, t.status]))}`);
    if ((await page.locator('[data-testid="week-key-result"]').count()) !== 3) throw new Error("the third key result added on edit shows");
    tasks = after;
    console.log("✓ an edit renames the task in its slot, removes the one taken off, keeps the done one done, and adds a key result");

    // ── The end of the week: Friday to Sunday, each key result done or not, once. ──
    if (expectedState === "review") {
      await submit(page, '[data-testid="week-review-save"]');
      await card.waitFor();
      if ((await page.locator('[data-testid="week-error"]').innerText()).trim() !== "Mark each key result done or not done.") throw new Error("the check needs every key result marked");
      await page.locator('[data-testid="week-review-kr1-done"]').check();
      await page.locator('[data-testid="week-review-kr2-not"]').check();
      await page.locator('[data-testid="week-review-kr3-done"]').check();
      await submit(page, '[data-testid="week-review-save"]');
      await page.locator('[data-testid="week-reviewed"]').waitFor({ timeout: 20000 });
      const marks = await page.locator('[data-testid="week-key-result"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-done")));
      if (JSON.stringify(marks) !== JSON.stringify(["yes", "no", "yes"]) || (await page.locator('[data-testid="week-review"]').count()) || (await card.getAttribute("data-state")) !== "shown") throw new Error(`marked once, and the check goes away, got ${marks.join(",")}`);
      console.log("✓ Friday to Sunday: the key results marked done / not done (2 of 3), and the check goes away");
    } else {
      if (await page.locator('[data-testid="week-review"]').count()) throw new Error("Monday to Thursday there is no end-of-week check");
      console.log(`✓ ${mayaToday} is before Friday: no end-of-week check yet (the unit tests cover Friday to Sunday)`);
    }
    await signOut();

    // ── The coach: who has set it, who hasn't, the quiet list from Tuesday, and each member's history. ──
    await signIn("coach");
    await page.goto(`${base}/coach`);
    const mayaRow = page.locator('[data-testid="week-coach-row"]', { hasText: maya.name });
    const jordanRow = page.locator('[data-testid="week-coach-row"]', { hasText: jordan.name });
    await mayaRow.waitFor({ timeout: 20000 });
    if ((await mayaRow.getAttribute("data-set")) !== "yes" || !(await mayaRow.innerText()).includes("Consistent")) throw new Error("the coach sees Maya's week and her word");
    if ((await jordanRow.getAttribute("data-set")) !== "no" || !(await jordanRow.innerText()).includes("not set yet")) throw new Error("the coach sees Jordan hasn't set it");
    const lateRows = await page.locator('[data-testid="week-late-row"]').allInnerTexts();
    const jordanLate = lateForWeek(jordanToday);
    if (lateRows.some((t) => t.includes(maya.name)) || lateRows.some((t) => t.includes(jordan.name)) !== jordanLate) throw new Error(`under the quiet list from Tuesday only: Jordan ${jordanLate ? "is" : "is not"} there on ${jordanToday}, got ${lateRows.join(" | ")}`);
    await page.goto(`${base}/coach/${mayaM.id}`);
    const history = page.locator('[data-testid="their-week"]');
    await history.first().waitFor({ timeout: 20000 });
    if ((await history.count()) !== 1 || !(await history.first().innerText()).includes("Consistent") || !(await history.first().innerText()).includes("Follow up with 12 leads")) throw new Error("the client page lists her weeks, with the word, key results and tasks");
    console.log(`✓ the coach: Maya set (Consistent), Jordan not set${jordanLate ? " and under the quiet list" : " (Monday: not yet on the quiet list)"}; Maya's history on her page`);
    await signOut();

    // ── 2. Open Office Hours: the member asks ahead of a Friday. ──
    await signIn("client");
    await page.goto(`${base}/office-hours`);
    await page.locator("#request").waitFor({ timeout: 20000 });
    const fridays = upcomingFridays(mayaToday);
    const oohRows = () => db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) });
    const NOTES = `Bring the calendar settings ${Date.now()}`;
    if (fridays.length) {
      const friday = fridays[fridays.length - 1];
      const fillRequest = async (desc: string) => {
        await page.locator('[data-testid="ooh-friday"]').first().selectOption(friday);
        await page.locator('[data-testid="ooh-description"]').first().fill(desc);
        await page.locator('[data-testid="ooh-tried"]').first().fill("Re-read the setup lesson and rebuilt the calendar link.");
        await page.locator('[data-testid="ooh-tools"]').first().fill("Community Loyalty, GoHighLevel");
        await page.locator('[data-testid="ooh-goal"]').first().fill("Bookings land on the right calendar.");
        await page.locator('[data-testid="ooh-category"]').first().selectOption("Chatbot");
      };
      if ((await page.locator('#request [data-testid="ooh-friday"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).join() !== fridays.join()) throw new Error(`only this month's upcoming Fridays are offered: ${fridays.join(", ")}`);
      // Gate one: going back to try it yourself sends nothing, and says so kindly.
      await fillRequest("My bot books the wrong calendar.");
      await page.locator('[data-testid="ooh-gate-back"]').check();
      await page.locator('[data-testid="ooh-promise"]').check();
      await submit(page, '[data-testid="ooh-submit"]');
      await page.locator('[data-testid="ooh-back"]').waitFor({ timeout: 20000 });
      if ((await oohRows()).length) throw new Error("going back to try it yourself saves nothing");
      // Gate two: the promise to attend must be ticked.
      await fillRequest("My bot books the wrong calendar.");
      await page.locator('[data-testid="ooh-gate-yes"]').check();
      await submit(page, '[data-testid="ooh-submit"]');
      if ((await page.locator('[data-testid="ooh-error"]').innerText()).trim() !== "Promise to attend the call, so your spot isn't wasted." || (await oohRows()).length) throw new Error("without the promise, nothing is sent");
      await fillRequest("My bot books the wrong calendar.");
      await page.locator('[data-testid="ooh-gate-yes"]').check();
      await page.locator('[data-testid="ooh-promise"]').check();
      await submit(page, '[data-testid="ooh-submit"]');
      await page.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
      let rows = await oohRows();
      if (rows.length !== 1 || rows[0].friday !== friday || rows[0].category !== "Chatbot" || rows[0].workspaceId !== ws.id) throw new Error(`the request is saved for ${friday}, from the login, got ${JSON.stringify(rows)}`);
      if ((await page.locator('[data-testid="ooh-mine"]').count()) !== 1) throw new Error("the member sees their request");
      // A change, until the Friday.
      await page.locator('[data-testid="ooh-edit"]').click();
      await page.locator('[data-testid="ooh-mine"] [data-testid="ooh-description"]').fill("My bot books the wrong calendar, only on weekends.");
      await submit(page, '[data-testid="ooh-mine"] [data-testid="ooh-submit"]');
      await page.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
      rows = await oohRows();
      if (rows.length !== 1 || rows[0].description !== "My bot books the wrong calendar, only on weekends.") throw new Error("a change edits the same request");
      console.log(`✓ Office Hours: going back sends nothing, the promise is required, the request for ${friday} is saved and changed; only ${fridays.length} upcoming Friday(s) offered`);
    } else {
      if (!(await page.locator('[data-testid="ooh-none"]').innerText()).includes("no Office Hours left this month")) throw new Error("with no Friday left this month, the page says so");
      await db.insert(schema.officeHoursRequests).values({ id: newId(), workspaceId: ws.id, userId: maya.id, friday: "2099-01-02", description: "My bot books the wrong calendar.", triedSelf: "Re-read the lesson.", goal: "Bookings land right.", category: "Chatbot" });
      console.log(`✓ Office Hours: no Friday left this month on ${mayaToday}, and the page says so (the unit tests cover the Fridays and the gates)`);
    }
    await signOut();

    // ── The coach: requests by Friday, who takes it, how it went, notes; the lists. ──
    await signIn("coach");
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/coach\/office-hours/), page.locator('[data-testid="coach-ooh-link"]').click()]);
    const req = page.locator('[data-testid="ooh-request"]', { hasText: maya.name });
    await req.waitFor({ timeout: 20000 });
    await req.locator('[data-testid="ooh-responsible"]').selectOption("Shonna Roadruck");
    await req.locator('[data-testid="ooh-outcome"]').selectOption("covered");
    await req.locator('[data-testid="ooh-notes"]').fill(NOTES);
    await submit(page, '[data-testid="ooh-request"] [data-testid="ooh-coach-save"]');
    await page.locator('[data-testid="ooh-updated"]').waitFor({ timeout: 20000 });
    const coachRow = (await oohRows())[0];
    if (coachRow.responsible !== "Shonna Roadruck" || coachRow.outcome !== "covered" || coachRow.coachNotes !== NOTES) throw new Error(`the coach's side is saved, got ${JSON.stringify(coachRow)}`);
    await page.locator('[data-testid="ooh-categories"]').fill("Chatbot\nAirtable\nFunnels\nFB Group Management\nOffer Creation\nTaxes\nOther");
    await submit(page, '[data-testid="ooh-lists-save"]');
    await page.locator('[data-testid="ooh-lists-saved"]').waitFor({ timeout: 20000 });
    if (!(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws.id) }))!.oohCategories.includes("Taxes")) throw new Error("the coach's category list is saved");
    await signOut();
    await signIn("client");
    await page.goto(`${base}/office-hours`);
    await page.locator('[data-testid="ooh-mine"]').first().waitFor({ timeout: 20000 });
    const mineText = await page.locator('[data-testid="ooh-mine"]').first().innerText();
    if (!mineText.includes("With Shonna Roadruck") || !mineText.includes("Covered") || (await page.content()).includes(NOTES)) throw new Error("the member sees who takes it and how it went, never the coach's notes");
    if (fridays.length && !(await page.locator('#request [data-testid="ooh-category"] option').evaluateAll((els) => els.map((e) => e.textContent))).includes("Taxes")) throw new Error("the member picks from the coach's list");
    const exported = await (await page.request.get(`${base}/api/export?format=json`)).text();
    if (!exported.includes("office_hours_requests") || !exported.includes("My bot books the wrong calendar") || exported.includes(NOTES) || exported.includes("coachNotes")) throw new Error("the member's export has their request and not the coach's notes");
    console.log("✓ the coach: the request under its Friday, Shonna responsible, covered, notes kept the coach's (not on the member's page, not in their export); a category added to the list");
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Rituals smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
