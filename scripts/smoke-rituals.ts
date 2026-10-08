/**
 * The member rituals inside HelixOS (handoff rev 124), walked as members and their coach meet them.
 * 1. The weekly 3-1-3, on Intentions (rev 157; Today asks for nothing, the menu's badge counts what's due): a word or a short
 *    phrase, key results that need a number (a refused form keeps everything typed, marks the field and focuses it, rev 160),
 *    a task-like key result nudged into the tasks or kept (marked for the coach), the tasks as this week's Tasks, due Friday; an
 *    edit renames, adds and removes them; Friday to Sunday "how many?" against each key result's number; the coach sees who has
 *    set it, who hasn't (under the quiet list from Tuesday), and each member's history.
 * 2. The Open Office Hours request: the two gates (going back saves nothing, the promise must be ticked), this month's upcoming
 *    the next four Fridays across month ends, the member's own list with a change until the Friday; the coach sees requests by Friday, sets who takes it,
 *    covered or no-show and notes the member never sees (nor their export), and edits the category and host lists.
 * 3. End-of-month feedback: the card on Intentions (never Today) only from the last 3 days of a month through the 5th of the next, about the month
 *    ending; the score required; sent and changed; the coach sees each month's responses, the average referral score and its
 *    trend, and the proud-of answers together, with nothing that sends them anywhere.
 * 4. The monthly intention on the Intentions page (rev 129/130/157): asked for in the month's first week, optional after, one line
 *    on Today once set; a refused one keeps every answer (rev 160); the eleven questions (a revenue goal as a number); edits and
 *    history there; the coach's month card, everyone's answers, the quiet list from the 4th and each member's history; one
 *    member never sees another's; and the feedback card shows the member what they wrote for question 11.
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
  const { MONTH_ASK_DAYS, NEEDS_NUMBER, intentionPrompt, intentionsDue, lateForWeek, tasksDueOn, weekOf } = await import("@/lib/engine/intentions");
  const { upcomingFridays } = await import("@/lib/engine/office-hours");
  const { feedbackMonth, monthSummary, prevMonth, trendLine } = await import("@/lib/engine/feedback");
  const { lateForMonth, monthOf } = await import("@/lib/engine/month-intentions");
  const { newId } = await import("@/lib/ids");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, mayaM.workspaceId) }))!;
  const jordanM = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, jordan.id), eq(schema.memberships.workspaceId, ws.id)) }))!;
  for (const u of [maya.id, jordan.id]) {
    await db.delete(schema.weeklyIntentions).where(eq(schema.weeklyIntentions.userId, u));
    await db.delete(schema.monthlyIntentions).where(eq(schema.monthlyIntentions.userId, u));
    await db.delete(schema.tasks).where(and(eq(schema.tasks.userId, u), eq(schema.tasks.source, "intention")));
    await db.delete(schema.officeHoursRequests).where(eq(schema.officeHoursRequests.userId, u));
    await db.delete(schema.monthlyFeedback).where(eq(schema.monthlyFeedback.userId, u));
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

    // ── 1. The 3-1-3, on Intentions (rev 157): Today asks for nothing; the menu's Intentions badge counts what's due. ──
    await signIn("client");
    await page.goto(`${base}/today`);
    await page.waitForLoadState("networkidle");
    if ((await card.count()) || (await page.locator('[data-testid="month-card"]').count()) || (await page.locator('[data-testid="feedback-card"]').count()) || (await page.locator('[data-testid="intentions-summary"]').count())) throw new Error("Today shows no Set your week, Set your month or feedback card, and no summary before anything is set");
    const dueNow = intentionsDue(mayaToday, { week: null, monthSet: false, feedbackMonth: feedbackMonth(mayaToday), feedbackGiven: false }).length;
    if (((await page.locator('aside [data-testid="due-badge"]').textContent()) ?? "").trim() !== String(dueNow)) throw new Error(`the Intentions badge counts what's due (${dueNow})`);
    await page.goto(`${base}/intentions`);
    await card.waitFor({ timeout: 20000 });
    if ((await card.getAttribute("data-state")) !== "set" || !((await card.textContent()) ?? "").includes("Set your week")) throw new Error("with no 3-1-3 this week, Intentions asks to set it");
    // A refused form keeps everything typed (rev 160), marks the field at fault beside it, and focuses it.
    const typed = { word: "Show up daily", kr: ["3 booked calls from my posts", "more leads", ""], initiative: "Finish my webinar slides", tasks: ["Follow up with 10 leads", "Record 2 videos", ""] };
    await fill(typed);
    await submit(page, '[data-testid="week-save"]');
    await page.locator('[data-testid="week-form"] [data-testid="field-error"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="week-error"]').innerText()).trim() !== NEEDS_NUMBER || (await db.query.weeklyIntentions.findFirst({ where: eq(schema.weeklyIntentions.userId, maya.id) }))) throw new Error("a key result without a number is refused, kindly, and nothing is saved");
    const kept = { word: await page.locator('[data-testid="week-word"]').last().inputValue(), kr: await Promise.all([1, 2, 3].map((i) => page.locator(`[data-testid="week-kr${i}"]`).last().inputValue())), initiative: await page.locator('[data-testid="week-initiative"]').last().inputValue(), tasks: await Promise.all([1, 2, 3].map((i) => page.locator(`[data-testid="week-task${i}"]`).last().inputValue())) };
    if (JSON.stringify(kept) !== JSON.stringify(typed)) throw new Error(`a refused 3-1-3 keeps every typed value: ${JSON.stringify(kept)}`);
    if ((await page.locator('[data-testid="week-kr2"]').last().getAttribute("aria-invalid")) !== "true" || !(await page.locator('[data-testid="week-kr2"]').last().evaluate((el) => el === document.activeElement))) throw new Error("the key result at fault is marked beside it and focused");
    // Rev 444: the 3-1-3 keeps a draft too, so a refresh after a refusal costs nothing.
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('[data-testid="week-form"] [data-testid="draft-restored"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="week-initiative"]').last().inputValue()) !== typed.initiative || (await page.locator('[data-testid="week-kr1"]').last().inputValue()) !== typed.kr[0]) throw new Error("a refresh brings the week's typed answers back as a draft");
    console.log("✓ rev 444: the 3-1-3 keeps a draft through a refresh");
    // A task written as a result: a nudge, with Move it to my tasks.
    await page.locator('[data-testid="week-kr2"]').last().fill("Post 5 times");
    await page.locator('[data-testid="week-kr2-nudge"]').waitFor({ timeout: 10000 });
    await page.locator('[data-testid="week-kr2-move"]').click();
    if ((await page.locator('[data-testid="week-kr2"]').last().inputValue()) !== "" || (await page.locator('[data-testid="week-task3"]').last().inputValue()) !== "Post 5 times") throw new Error("Move it to my tasks moves the line into the free task slot and empties the key result");
    await page.locator('[data-testid="week-kr2"]').last().fill("10 new leads from my lead magnet");
    await submit(page, '[data-testid="week-save"]');
    await page.locator('[data-testid="save-confirm"]').first().waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="save-confirm"]').first().innerText()).trim() !== "Saved ✓") throw new Error("a save on Intentions shows the green confirmation");
    const saved = (await db.query.weeklyIntentions.findFirst({ where: eq(schema.weeklyIntentions.userId, maya.id) }))!;
    if (saved.weekOf !== week || saved.word !== "Show up daily" || saved.keyResults.length !== 2 || saved.tasks.length !== 3) throw new Error(`saved for this week with a short phrase as its word, the blank third key result dropped, got ${JSON.stringify(saved)}`);
    // Today keeps one line once set, and links to the check Friday to Sunday.
    const expectedState = intentionPrompt(mayaToday, { reviewedAt: null });
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="summary-week-word"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="summary-week-word"]').innerText()).trim() !== "Show up daily" || (await card.count())) throw new Error("once set, Today shows only the week's word, as written, in one line");
    if ((await page.locator('[data-testid="summary-review"]').count()) !== (expectedState === "review" ? 1 : 0)) throw new Error("Friday to Sunday, Today's line links to the end-of-week check");
    await page.goto(`${base}/intentions`);
    await card.waitFor({ timeout: 20000 });
    if ((await card.getAttribute("data-state")) !== expectedState || (await page.locator('[data-testid="week-word-shown"]').innerText()).trim() !== "Show up daily") throw new Error(`once set, Intentions shows the week (${expectedState})`);
    let tasks = await intentionTasks();
    if (tasks.length !== 3 || tasks.some((t) => t.dueDate !== tasksDueOn(mayaToday) || t.sourceRef !== week) || tasks.map((t) => t.title).join("|") !== "Follow up with 10 leads|Record 2 videos|Post 5 times") throw new Error(`the three tasks are this week's Tasks, due Friday, got ${JSON.stringify(tasks.map((t) => [t.title, t.dueDate]))}`);
    await page.goto(`${base}/tasks`);
    for (const t of tasks) await page.getByText(t.title, { exact: false }).first().waitFor({ timeout: 15000 });
    console.log(`✓ the 3-1-3 on Intentions: Today asks nothing and the menu badge counts ${dueNow}; a key result without a number refused with everything typed kept, the field marked and focused; a task-like key result moved to the tasks; a short phrase as the word; saved with the green confirmation; Today keeps one line (${expectedState}); the tasks are on Tasks, due ${tasksDueOn(mayaToday)}`);

    // ── Edit: the first task renamed in place, the third taken off; a done task stays done. ──
    await db.update(schema.tasks).set({ status: "done" }).where(eq(schema.tasks.id, tasks[1].id));
    await page.goto(`${base}/intentions`);
    await card.waitFor();
    if ((await page.locator('[data-testid="week-task"][data-done="yes"]').count()) !== 1) throw new Error("a task ticked off on Tasks shows done on the week");
    await page.locator('[data-testid="week-edit"]').click();
    await fill({ word: "Show up daily", kr: ["3 booked calls from my posts", "10 new leads from my lead magnet", "Post 3 reels"], initiative: "Finish my webinar slides", tasks: ["Follow up with 12 leads", "Record 2 videos", ""] });
    // A task-like key result can be kept as written; the save marks it for the coach.
    await page.locator('[data-testid="week-kr3-nudge"]').last().waitFor({ timeout: 10000 });
    await page.locator('[data-testid="week-kr3-keep"]').last().click();
    if (await page.locator('[data-testid="week-kr3-nudge"]').count()) throw new Error("Keep it closes the nudge");
    await submit(page, '[data-testid="week-save"]');
    await page.locator('[data-testid="week-saved"]').waitFor({ timeout: 20000 });
    const after = await intentionTasks();
    if (after.length !== 2 || after[0].id !== tasks[0].id || after[0].title !== "Follow up with 12 leads" || after[1].id !== tasks[1].id || after[1].status !== "done") throw new Error(`an edit renames in place, removes the one taken off and keeps a done one, got ${JSON.stringify(after.map((t) => [t.title, t.status]))}`);
    if ((await page.locator('[data-testid="week-key-result"]').count()) !== 3) throw new Error("the third key result added on edit shows");
    const keptKr = (await db.query.weeklyIntentions.findFirst({ where: eq(schema.weeklyIntentions.userId, maya.id) }))!.keyResults;
    if (!keptKr[2].kept || keptKr[0].kept) throw new Error("a key result kept as written though it reads like a task is marked for the coach, and only that one");
    tasks = after;
    console.log("✓ an edit renames the task in its slot, removes the one taken off, keeps the done one done, and adds a key result (a task-like one kept as written, marked for the coach)");

    // ── The end of the week: Friday to Sunday, each key result done or not, once. ──
    if (expectedState === "review") {
      await submit(page, '[data-testid="week-review-save"]');
      await card.waitFor();
      if ((await page.locator('[data-testid="week-error"]').innerText()).trim() !== "Write how many you got for each key result, like 2.") throw new Error("the check needs a count for every key result");
      // How many, against the number set: done means the number was hit.
      await page.locator('[data-testid="week-review-kr1-count"]').fill("2");
      await page.locator('[data-testid="week-review-kr2-count"]').fill("12");
      await page.locator('[data-testid="week-review-kr3-count"]').fill("3");
      await submit(page, '[data-testid="week-review-save"]');
      await page.locator('[data-testid="week-reviewed"]').waitFor({ timeout: 20000 });
      const marks = await page.locator('[data-testid="week-key-result"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-done")));
      const shown = await page.locator('[data-testid="week-key-result"]').first().innerText();
      if (JSON.stringify(marks) !== JSON.stringify(["no", "yes", "yes"]) || !shown.includes("2 of 3 booked calls from my posts") || (await page.locator('[data-testid="week-review"]').count()) || (await card.getAttribute("data-state")) !== "shown") throw new Error(`checked against the number (2 of 3 is not done; 12 of 10 is), and the check goes away, got ${marks.join(",")} / ${shown}`);
      console.log("✓ Friday to Sunday: how many for each key result, against its number (2 of 3 booked calls: not done), and the check goes away");
    } else {
      if (await page.locator('[data-testid="week-review"]').count()) throw new Error("Monday to Thursday there is no end-of-week check");
      console.log(`✓ ${mayaToday} is before Friday: no end-of-week check yet (the unit tests cover Friday to Sunday)`);
    }

    // ── 4. The monthly intention, on Intentions (rev 157): asked for in the month's first week, optional after, never on Today. ──
    const thisMonth = monthOf(mayaToday);
    const PAST_PROUD = `Showing up for my clients every week ${Date.now()}`;
    await page.goto(`${base}/intentions`);
    const monthCard = page.locator('[data-testid="month-card"]');
    await monthCard.waitFor({ timeout: 20000 });
    if ((await monthCard.getAttribute("data-state")) !== "set") throw new Error("with no intention this month, Intentions offers to set it");
    if ((await page.locator('[data-testid="month-optional"]').count()) !== (Number(mayaToday.slice(8, 10)) > MONTH_ASK_DAYS ? 1 : 0)) throw new Error("after the month's first week, setting it is optional, and says so");
    const MONTH_TEXT: [string, string][] = [["fear", "That I'm not ready."], ["habit", "A morning walk."], ["skill", "Public speaking."], ["impact", "Help 5 coaches book calls; they benefit most."], ["revenueWhy", "To hire help."], ["plan", "Two webinars and daily DMs."], ["proudLast", "Finishing my offer."], ["proudEnd", "Showing up every single day."]];
    const fillMonth = async (revenue: string) => {
      await page.locator('[data-testid="month-word"]').last().fill("Rooted and ready");
      await page.locator('[data-testid="month-personalSeason-wealth"]').last().check();
      for (const [k, t] of MONTH_TEXT) await page.locator(`[data-testid="month-${k}"]`).last().fill(t);
      await page.locator('[data-testid="month-businessSeason-sales"]').last().check();
      await page.locator('[data-testid="month-revenueGoal"]').last().fill(revenue);
    };
    await fillMonth("lots");
    // A slip (a refresh) loses nothing: the typed answers come back as a draft (rev 160).
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('[data-testid="month-form"] [data-testid="draft-restored"]').filter({ hasText: "Draft restored" }).waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="month-plan"]').last().inputValue()) !== "Two webinars and daily DMs." || !(await page.locator('[data-testid="month-businessSeason-sales"]').last().isChecked())) throw new Error("a refresh brings the month's typed answers back as a draft");
    await submit(page, '[data-testid="month-save"]');
    await page.locator('[data-testid="month-form"] [data-testid="field-error"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="month-error"]').innerText()).trim() !== "Write the amount as a number, like 3500." || (await db.query.monthlyIntentions.findFirst({ where: eq(schema.monthlyIntentions.userId, maya.id) }))) throw new Error("a revenue goal that isn't a number is refused, and nothing saved");
    // Every answer typed is still there, the seasons too, and the revenue goal is marked and focused.
    const monthKept = await Promise.all(MONTH_TEXT.map(async ([k]) => page.locator(`[data-testid="month-${k}"]`).last().inputValue()));
    if (JSON.stringify(monthKept) !== JSON.stringify(MONTH_TEXT.map(([, t]) => t)) || (await page.locator('[data-testid="month-word"]').last().inputValue()) !== "Rooted and ready" || !(await page.locator('[data-testid="month-personalSeason-wealth"]').last().isChecked()) || !(await page.locator('[data-testid="month-businessSeason-sales"]').last().isChecked()) || (await page.locator('[data-testid="month-revenueGoal"]').last().inputValue()) !== "lots") throw new Error("a refused month keeps every typed answer");
    if (!(await page.locator('[data-testid="month-revenueGoal"]').last().evaluate((el) => el === document.activeElement && el.getAttribute("aria-invalid") === "true"))) throw new Error("the revenue goal is marked beside it and focused");
    // Rev 444: "3.5k" reads as money, shown before Save; with one required answer left blank, the refusal marks only that one
    // and every other answer stays, the goal still reading $3,500.
    await page.locator('[data-testid="month-revenueGoal"]').last().fill("3.5k");
    if ((await page.locator('[data-testid="month-form"] [data-testid="money-read"]').last().innerText()).trim() !== "Reads as $3,500") throw new Error("the goal says what it understood before Save");
    await page.locator('[data-testid="month-plan"]').last().fill("");
    await submit(page, '[data-testid="month-save"]');
    await page.locator('[data-testid="month-form"] [data-testid="field-error"]').waitFor({ timeout: 20000 });
    const marked = await page.locator('[data-testid="month-form"] [aria-invalid="true"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
    if (JSON.stringify(marked) !== JSON.stringify(["plan"])) throw new Error(`only the blank answer is marked: ${marked.join(",")}`);
    const keptAfter = await Promise.all(MONTH_TEXT.filter(([k]) => k !== "plan").map(async ([k]) => page.locator(`[data-testid="month-${k}"]`).last().inputValue()));
    if (JSON.stringify(keptAfter) !== JSON.stringify(MONTH_TEXT.filter(([k]) => k !== "plan").map(([, t]) => t)) || (await page.locator('[data-testid="month-revenueGoal"]').last().inputValue()) !== "3.5k" || (await page.locator('[data-testid="month-form"] [data-testid="money-read"]').last().innerText()).trim() !== "Reads as $3,500") throw new Error("every other answer stays, and the goal still reads $3,500");
    await page.locator('[data-testid="month-plan"]').last().fill("Two webinars and daily DMs.");
    console.log("✓ rev 444: \"3.5k\" reads as $3,500 before Save; a blank answer marks only itself and everything else stays");
    await page.locator('[data-testid="month-revenueGoal"]').last().fill("$10,000");
    // A save that never answers (3 Oct: a member lost his month's answers to a glitch): the connection drops as Save is pressed.
    // The page says so and keeps the typing; a reload brings every answer back, marked as a save that didn't go through.
    await page.waitForTimeout(500);
    await page.route("**/intentions*", (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
    await page.locator('[data-testid="month-save"]').last().click();
    await page.locator('[data-testid="app-error"]').waitFor({ timeout: 20000 });
    if (!(await page.locator('[data-testid="app-error"]').innerText()).includes("kept in this browser")) throw new Error("a failed save says plainly that the typing is kept");
    await page.unroute("**/intentions*");
    if (await db.query.monthlyIntentions.findFirst({ where: eq(schema.monthlyIntentions.userId, maya.id) })) throw new Error("the dropped save wrote nothing");
    await page.reload();
    const failedNote = page.locator('[data-testid="month-form"] [data-testid="draft-restored"][data-kind="failed"]');
    await failedNote.waitFor({ timeout: 20000 });
    if (!(await failedNote.innerText()).includes("Your last save didn't go through")) throw new Error("the restored answers say the last save didn't go through");
    const afterDrop = await Promise.all(MONTH_TEXT.map(async ([k]) => page.locator(`[data-testid="month-${k}"]`).last().inputValue()));
    if (JSON.stringify(afterDrop) !== JSON.stringify(MONTH_TEXT.map(([, t]) => t)) || (await page.locator('[data-testid="month-revenueGoal"]').last().inputValue()) !== "$10,000" || !(await page.locator('[data-testid="month-personalSeason-wealth"]').last().isChecked())) throw new Error("after a dropped save and a reload, every answer is back as typed");
    await submit(page, '[data-testid="month-save"]');
    await page.locator('[data-testid="month-saved"]').waitFor({ timeout: 20000 });
    // Saved: the draft is gone, so a later visit shows the answers from HelixOS and no draft line.
    await page.reload();
    await page.waitForTimeout(800);
    if (await page.locator('[data-testid="draft-restored"]:visible').count()) throw new Error("once saved, no draft comes back");
    const mi = (await db.query.monthlyIntentions.findFirst({ where: eq(schema.monthlyIntentions.userId, maya.id) }))!;
    // Rev 444 part two: a draft follows the member to another device. The confirmed save above took the server's copy too.
    const draftKey = `month.${maya.id}.${mi.month}`;
    if (await db.query.formDrafts.findFirst({ where: and(eq(schema.formDrafts.userId, maya.id), eq(schema.formDrafts.key, draftKey)) })) throw new Error("a confirmed save drops the server's draft too");
    await page.locator('[data-testid="month-edit"]').click();
    await page.locator('[data-testid="month-word"]').last().fill("Steady on the phone");
    {
      const deadline = Date.now() + 15000;
      let row = await db.query.formDrafts.findFirst({ where: and(eq(schema.formDrafts.userId, maya.id), eq(schema.formDrafts.key, draftKey)) });
      while ((!row || !row.data.includes("Steady on the phone")) && Date.now() < deadline) {
        await page.waitForTimeout(500);
        row = await db.query.formDrafts.findFirst({ where: and(eq(schema.formDrafts.userId, maya.id), eq(schema.formDrafts.key, draftKey)) });
      }
      if (!row?.data.includes("Steady on the phone") || row.workspaceId !== ws.id) throw new Error("the typing reaches the server's copy a moment after it rests");
    }
    {
      // Another device: a browser with nothing kept, the same member.
      const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      await other.goto(`${base}/login`);
      await other.click('button:has-text("As a client")');
      await other.waitForURL(/\/today/);
      await other.goto(`${base}/intentions`);
      await other.locator('[data-testid="month-form"] [data-testid="draft-restored"]').filter({ hasText: "Draft restored" }).waitFor({ timeout: 20000 });
      if ((await other.locator('[data-testid="month-word"]').last().inputValue()) !== "Steady on the phone") throw new Error("the draft typed on one device comes back on another");
      await other.context().close();
    }
    // Put the word back as saved, so nothing differs and no draft line shows on later visits.
    await page.locator('[data-testid="month-word"]').last().fill(mi.word);
    await page.waitForTimeout(2800);
    await db.delete(schema.formDrafts).where(and(eq(schema.formDrafts.userId, maya.id), eq(schema.formDrafts.key, draftKey)));
    console.log("✓ rev 444 part two: a month draft typed on one device comes back on another (a fresh browser), and a confirmed save drops the server's copy");
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="summary-month-word"]').waitFor({ timeout: 20000 });
    if (mi.month !== thisMonth || mi.word !== "Rooted and ready" || mi.revenueGoal !== 10000 || mi.personalSeason !== "wealth" || mi.businessSeason !== "sales" || (await monthCard.count()) || (await page.locator('[data-testid="summary-month-word"]').innerText()).trim() !== "Rooted and ready") throw new Error(`saved for ${thisMonth}; Today keeps one line with the month's words beside the week's`);
    // Intentions: the answers, an edit, and the history of past weeks and months in folds.
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, weekOf: "2026-01-05", word: "Patient", keyResults: [{ text: "Post 3 times", done: true }], initiative: "Plan Q1", tasks: [{ title: "Draft the plan", taskId: null }], reviewedAt: "2026-01-09T18:00:00Z" });
    await db.insert(schema.monthlyIntentions).values({ id: newId(), workspaceId: ws.id, userId: maya.id, month: prevMonth(thisMonth), word: "Steady", personalSeason: "self", fear: "Being seen.", habit: "Journaling.", skill: "Sales calls.", impact: "More clients served.", businessSeason: "marketing", revenueGoal: 5000, revenueWhy: "A first full month.", plan: "Daily posts.", proudLast: "Starting.", proudEnd: PAST_PROUD });
    await page.goto(`${base}/intentions`);
    await monthCard.waitFor({ timeout: 20000 });
    if ((await monthCard.getAttribute("data-state")) !== "shown" || !(await page.locator('[data-testid="month-answers"]').first().innerText()).includes("$10,000. To hire help.")) throw new Error("Intentions shows the month's answers, the revenue goal with its why");
    await page.locator('[data-testid="month-edit"]').click();
    await page.locator('[data-testid="month-habit"]').last().fill("A morning walk, no phone.");
    await submit(page, '[data-testid="month-save"]');
    await page.locator('[data-testid="month-saved"]').waitFor({ timeout: 20000 });
    if ((await db.query.monthlyIntentions.findFirst({ where: and(eq(schema.monthlyIntentions.userId, maya.id), eq(schema.monthlyIntentions.month, thisMonth)) }))!.habit !== "A morning walk, no phone.") throw new Error("an edit on Intentions changes the month");
    const hWeeks = await page.locator('[data-testid="history-week"]').allInnerTexts();
    const hMonths = await page.locator('[data-testid="history-month"]').allInnerTexts();
    if (!hWeeks.some((t) => t.includes("Patient")) || !hMonths.some((t) => t.includes("Steady")) || hWeeks.some((t) => t.includes("Show up daily")) || hMonths.some((t) => t.includes("Rooted and ready"))) throw new Error("history holds the past weeks and months only, each in a fold");
    console.log(`✓ the monthly intention on Intentions (optional after the first week): a draft restored after a refresh; a non-number revenue goal refused with every answer kept and the field focused; a short phrase as the word; one line on Today after; the answers, an edit, and the history (a past week and month)`);
    await signOut();

    // ── One member never sees another's intention or revenue goal. ──
    await page.goto(`${base}/login`);
    await page.fill('input[name="email"]', "client2@demo.helixos.app");
    await page.fill('input[name="password"]', "demo1234");
    await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
    await page.goto(`${base}/intentions`);
    await monthCard.waitFor({ timeout: 20000 });
    const jordanPage = await page.content();
    if ((await monthCard.getAttribute("data-state")) !== "set" || jordanPage.includes("Rooted") || jordanPage.includes("10,000") || jordanPage.includes("Steady")) throw new Error("Jordan sees only an empty month of their own, nothing of Maya's");
    console.log("✓ another member's Intentions shows only their own: none of Maya's words or revenue");
    await signOut();

    // ── The coach: who has set it, who hasn't, the quiet list from Tuesday, and each member's history. ──
    await signIn("coach");
    await page.goto(`${base}/coach`);
    const mayaRow = page.locator('[data-testid="week-coach-row"]', { hasText: maya.name });
    const jordanRow = page.locator('[data-testid="week-coach-row"]', { hasText: jordan.name });
    await mayaRow.waitFor({ timeout: 20000 });
    if ((await mayaRow.getAttribute("data-set")) !== "yes" || !(await mayaRow.innerText()).includes("Show up daily")) throw new Error("the coach sees Maya's week and word");
    if ((await jordanRow.getAttribute("data-set")) !== "no" || !(await jordanRow.innerText()).includes("not set yet")) throw new Error("the coach sees Jordan hasn't set it");
    const lateRows = await page.locator('[data-testid="week-late-row"]').allInnerTexts();
    const jordanLate = lateForWeek(jordanToday);
    if (lateRows.some((t) => t.includes(maya.name)) || lateRows.some((t) => t.includes(jordan.name)) !== jordanLate) throw new Error(`under the quiet list from Tuesday only: Jordan ${jordanLate ? "is" : "is not"} there on ${jordanToday}, got ${lateRows.join(" | ")}`);
    await page.goto(`${base}/coach/${mayaM.id}`);
    const history = page.locator('[data-testid="their-week"]');
    await history.first().waitFor({ timeout: 20000 });
    if ((await history.count()) !== 2 || !(await history.nth(1).innerText()).includes("Patient") || !(await history.first().innerText()).includes("Show up daily") || !(await history.first().innerText()).includes("Follow up with 12 leads")) throw new Error("the client page lists the member's weeks, newest first, with the word, key results and tasks");
    if ((await history.first().locator('[data-testid="their-kr-kept"]').count()) !== 1) throw new Error("the coach sees the key result kept as written though it reads like a task");
    console.log(`✓ the coach: Maya set (Show up daily), Jordan not set${jordanLate ? " and under the quiet list" : " (Monday: not yet on the quiet list)"}; Maya's history on Maya's page`);
    await page.goto(`${base}/coach`);
    const mayaMonth = page.locator('[data-testid="month-coach-row"]', { hasText: maya.name });
    await mayaMonth.waitFor({ timeout: 20000 });
    if ((await mayaMonth.getAttribute("data-set")) !== "yes" || !(await mayaMonth.innerText()).includes("Rooted") || (await page.locator('[data-testid="month-coach-row"]', { hasText: jordan.name }).getAttribute("data-set")) !== "no") throw new Error("the coach sees Maya's month and word, and Jordan's not set");
    await page.locator('[data-testid="month-coach-answers"]').click();
    if (!(await page.locator('[data-testid="month-coach-answer"]').first().innerText()).includes("$10,000")) throw new Error("the coach sees everyone's answers in a fold, revenue included");
    const monthLateRows = await page.locator('[data-testid="month-late-row"]').allInnerTexts();
    if (monthLateRows.some((t) => t.includes(jordan.name)) !== lateForMonth(jordanToday) || monthLateRows.some((t) => t.includes(maya.name))) throw new Error(`the quiet list from the 4th only: got ${monthLateRows.join(" | ")}`);
    if ((await page.locator(`[data-testid="month-coach-row"] a[href="/coach/${mayaM.id}#intentions"]`).count()) !== 1) throw new Error("the row links to the intentions on Maya's page");
    await page.goto(`${base}/coach/${mayaM.id}#intentions`);
    const theirMonths = await page.locator('[data-testid="their-month"]').allInnerTexts();
    if (theirMonths.length !== 2 || !theirMonths[0].includes("Rooted") || !theirMonths[1].includes("Steady")) throw new Error(`Maya's page lists Maya's months, newest first, got ${theirMonths.join(" | ")}`);
    console.log(`✓ the coach: Maya's month (Rooted) and everyone's answers, Jordan not set${lateForMonth(jordanToday) ? " and under the quiet list" : ""}; Maya's months on Maya's page`);
    await signOut();

    // ── 2. Open Office Hours: the member asks ahead of a Friday. ──
    await signIn("client");
    await page.goto(`${base}/office-hours`);
    await page.locator("#request").waitFor({ timeout: 20000 });
    const fridays = upcomingFridays(mayaToday);
    const oohRows = () => db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) });
    const NOTES = `Bring the calendar settings ${Date.now()}`;
    const friday = fridays[fridays.length - 1];
    const fillRequest = async (desc: string) => {
      await page.locator('[data-testid="ooh-friday"]').first().selectOption(friday);
      await page.locator('[data-testid="ooh-description"]').first().fill(desc);
      await page.locator('[data-testid="ooh-tried"]').first().fill("Re-read the setup lesson and rebuilt the calendar link.");
      await page.locator('[data-testid="ooh-tools"]').first().fill("Community Loyalty, GoHighLevel");
      await page.locator('[data-testid="ooh-goal"]').first().fill("Bookings land on the right calendar.");
      await page.locator('[data-testid="ooh-category"]').first().selectOption("Chatbot");
    };
    if ((await page.locator('#request [data-testid="ooh-friday"] option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).join() !== fridays.join()) throw new Error(`the next four Fridays are offered: ${fridays.join(", ")}`);
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
    console.log(`✓ Office Hours: going back sends nothing, the promise is required, the request for ${friday} is saved and changed; the next ${fridays.length} Fridays offered, across month ends`);
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
    await page.locator('[data-testid="ooh-time"]').fill("Fridays at 12:00 pm");
    await page.locator('[data-testid="ooh-link"]').fill("https://example.com/office-hours");
    await submit(page, '[data-testid="ooh-lists-save"]');
    await page.locator('[data-testid="ooh-lists-saved"]').waitFor({ timeout: 20000 });
    if (!(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws.id) }))!.oohCategories.includes("Taxes")) throw new Error("the coach's category list is saved");
    await signOut();
    await signIn("client");
    await page.goto(`${base}/office-hours`);
    await page.locator('[data-testid="ooh-mine"]').first().waitFor({ timeout: 20000 });
    // The member reads when and where (friction walk OH1): the time in the workspace's zone and the join link, new tab.
    const when = await page.locator('[data-testid="ooh-when"]').innerText();
    if (!when.includes("Fridays at 12:00 pm") || !when.includes("America/Los_Angeles")) throw new Error(`the member sees the call's time and zone: ${when}`);
    if ((await page.locator('[data-testid="ooh-join"]').getAttribute("href")) !== "https://example.com/office-hours" || (await page.locator('[data-testid="ooh-join"]').getAttribute("target")) !== "_blank") throw new Error("the join link opens the call in a new tab");
    const mineText = await page.locator('[data-testid="ooh-mine"]').first().innerText();
    if (!mineText.includes("With Shonna Roadruck") || !mineText.includes("Covered") || (await page.content()).includes(NOTES)) throw new Error("the member sees who takes it and how it went, never the coach's notes");
    if (!(await page.locator('#request [data-testid="ooh-category"] option').evaluateAll((els) => els.map((e) => e.textContent))).includes("Taxes")) throw new Error("the member picks from the coach's list");
    const exported = await (await page.request.get(`${base}/api/export?format=json`)).text();
    if (!exported.includes("office_hours_requests") || !exported.includes("My bot books the wrong calendar") || exported.includes(NOTES) || exported.includes("coachNotes")) throw new Error("the member's export has their request and not the coach's notes");
    console.log("✓ the coach: the request under its Friday, Shonna responsible, covered, notes kept the coach's (not on the member's page, not in their export); a category added to the list");

    // ── 3. End-of-month feedback, on Intentions in its window only (rev 157: never on Today). ──
    const PROUD = `Booked my first 3 calls ${Date.now()}`;
    const fbMonth = feedbackMonth(mayaToday);
    const month = fbMonth ?? mayaToday.slice(0, 7);
    await page.goto(`${base}/today`);
    await page.locator('[data-testid="intentions-summary"]').waitFor({ timeout: 20000 });
    if (await page.locator('[data-testid="feedback-card"]').count()) throw new Error("feedback is never on Today");
    await page.goto(`${base}/intentions`);
    await page.locator('[data-testid="week-card"]').waitFor({ timeout: 20000 });
    const fbCard = page.locator('[data-testid="feedback-card"]');
    if (fbMonth) {
      if ((await fbCard.getAttribute("data-state")) !== "ask") throw new Error(`in the window (${mayaToday}), Intentions asks for feedback on ${fbMonth}`);
      // What Maya wrote for that month's question 11, shown back to compare.
      const wrote = fbMonth === thisMonth ? "Showing up every single day." : PAST_PROUD;
      if (!(await page.locator('[data-testid="feedback-lookback"]').innerText()).includes(wrote)) throw new Error(`the feedback card shows what Maya wrote for question 11 of ${fbMonth}`);
      const fillFeedback = async () => {
        for (const [k, t] of [["proud", PROUD], ["love", "The Friday calls."], ["less", "Long lessons."], ["more", "Templates."], ["wow", "A done-for-you funnel."], ["referral", "Sam, a fitness coach."], ["favorite", "The community."]]) await page.locator(`[data-testid="feedback-${k}"]`).last().fill(t);
      };
      await fillFeedback();
      await submit(page, '[data-testid="feedback-save"]');
      if ((await page.locator('[data-testid="feedback-error"]').innerText()).trim() !== "Pick a referral score from 1 to 10." || (await db.query.monthlyFeedback.findFirst({ where: eq(schema.monthlyFeedback.userId, maya.id) }))) throw new Error("without a score, nothing is sent");
      // Favorite part is required (rev 129); Referral stays optional.
      await fillFeedback();
      await page.locator('[data-testid="feedback-favorite"]').last().fill("");
      await page.locator('[data-testid="feedback-referral"]').last().fill("");
      await page.locator('[data-testid="feedback-score-9"]').last().check();
      await submit(page, '[data-testid="feedback-save"]');
      if ((await page.locator('[data-testid="feedback-error"]').innerText()).trim() !== "Tell us your favorite part of the experience so far.") throw new Error("without a favorite part, nothing is sent");
      await fillFeedback();
      await page.locator('[data-testid="feedback-referral"]').last().fill("");
      await page.locator('[data-testid="feedback-score-9"]').last().check();
      await submit(page, '[data-testid="feedback-save"]');
      await page.locator('[data-testid="feedback-saved"]').waitFor({ timeout: 20000 });
      if ((await fbCard.getAttribute("data-state")) !== "given") throw new Error("once sent, the card thanks them");
      await page.locator('[data-testid="feedback-edit"]').click();
      await page.locator('[data-testid="feedback-score-10"]').last().check();
      await submit(page, '[data-testid="feedback-save"]');
      await page.locator('[data-testid="feedback-saved"]').waitFor({ timeout: 20000 });
      const fb = await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.userId, maya.id) });
      if (fb.length !== 1 || fb[0].month !== fbMonth || fb[0].referralScore !== 10 || fb[0].proud !== PROUD) throw new Error(`one response for ${fbMonth}, changed in place, got ${JSON.stringify(fb.map((f) => [f.month, f.referralScore]))}`);
      console.log(`✓ feedback on ${fbMonth}: the score and the favorite part required, sent with no referral, then changed in place (9 to 10)`);
    } else {
      if (await fbCard.count()) throw new Error(`outside the window (${mayaToday}) there is no feedback card`);
      await db.insert(schema.monthlyFeedback).values({ id: newId(), workspaceId: ws.id, userId: maya.id, month, proud: PROUD, love: "The Friday calls.", less: "Long lessons.", more: "Templates.", wow: "A done-for-you funnel.", referralScore: 10 });
      console.log(`✓ feedback: ${mayaToday} is outside the window, so Intentions asks nothing (the unit tests cover the window; a response is seeded for the coach's view)`);
    }
    const exportedFb = await (await page.request.get(`${base}/api/export?format=json`)).text();
    if (!exportedFb.includes("monthly_feedback") || !exportedFb.includes(PROUD)) throw new Error("the member's export has their feedback");
    await signOut();

    // The coach: this month and the one before, for the average and its trend.
    await db.insert(schema.monthlyFeedback).values([
      { id: newId(), workspaceId: ws.id, userId: jordan.id, month, proud: "Launched my group.", love: "Office Hours.", less: "Email.", more: "Hot seats.", wow: "A retreat.", referralScore: 7 },
      { id: newId(), workspaceId: ws.id, userId: jordan.id, month: prevMonth(month), proud: "Posted every day.", love: "The pathway.", less: "Tech.", more: "Examples.", wow: "Live builds.", referralScore: 6 },
    ]);
    const all = await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, ws.id) });
    const avg = monthSummary(all.filter((f) => f.month === month).map((f) => f.referralScore)).average;
    const trend = trendLine(avg, monthSummary(all.filter((f) => f.month === prevMonth(month)).map((f) => f.referralScore)).average);
    await signIn("coach");
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/coach\/feedback/), page.locator('[data-testid="coach-feedback-link"]').click()]);
    const monthBox = page.locator(`[data-testid="feedback-month"][data-month="${month}"]`);
    await monthBox.waitFor({ timeout: 20000 });
    const averageLine = (await monthBox.locator('[data-testid="feedback-average"]').innerText()).trim();
    if (!averageLine.includes(`${avg?.toFixed(1)} of 10`) || !averageLine.includes(trend)) throw new Error(`the month's average and trend (${avg}, ${trend}), got "${averageLine}"`);
    const proudList = await monthBox.locator('[data-testid="feedback-proud"]').innerText();
    if (!proudList.includes(PROUD) || !proudList.includes("Launched my group.")) throw new Error("the proud-of answers are listed together");
    if (await page.locator('main form').count()) throw new Error("nothing on the feedback page sends an answer anywhere");
    console.log(`✓ the coach: ${month} with ${avg?.toFixed(1)} average (${trend} on the month before), the proud-of answers together, and no way to send them on`);
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
