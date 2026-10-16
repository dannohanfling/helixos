/**
 * Office Hours for a team (H-413), at runtime, against the running dev server:
 *  1. The owner (Maya) invites Sam from Settings → Team; Sam joins with his own login. Maya has a request of her own already.
 *  2. Sam sees Office Hours in the menu and on the team home, opens it, and the attendee list is exactly Maya and Sam. An
 *     "Others" line with an email in it is refused. Sam books for Maya with both attending and "Lee" as another name.
 *  3. The request is Maya's (same account, same queue) with Sam as its submitter; one "change" row on Maya's team log; no points
 *     moved. Sam sees his request and not Maya's own. At 390 px the page has no sideways scroll.
 *  4. Maya: a line on Today and at the top of Office Hours says Sam booked for her; both requests show, Sam's with "Submitted by"
 *     and who's attending; opening Office Hours clears the line, so Today no longer carries it.
 *  5. The coach's queue shows the request under Maya with "Submitted by Sam Vale" and the attendees.
 *  6. Maya removes Sam: the request stays, and Sam now reads as a former team member for Maya and the coach.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = "teampass123";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { upcomingFridays } = await import("@/lib/engine/office-hours");

  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  try {
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = mayaM.workspaceId;
    const run = randomUUID().slice(0, 8);
    const samEmail = `sam.ooh.${run}@demo.helixos.app`;
    const today = new Date().toISOString().slice(0, 10);
    const fridays = upcomingFridays(today);
    // Maya's own request, hers alone: a team member must never read the word.
    const privateWord = `MayaPrivateQuestion${run}`;
    await db.insert(schema.officeHoursRequests).values({ id: newId(), workspaceId: ws, userId: maya.id, friday: fridays[1], description: `${privateWord} about my funnel.`, triedSelf: "Read the lesson.", goal: "A working funnel.", category: "Funnels" });
    const pointsBefore = (await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).length;

    // ── 1. Maya invites; Sam joins. ──
    const owner = await browser.newPage();
    watch(owner);
    await login(owner, "As a client");
    await owner.goto(`${base}/settings`);
    await owner.locator('[data-testid="team-invite-form"]').waitFor({ timeout: 20000 });
    await owner.fill('[data-testid="team-invite-form"] input[name="label"]', "Sam, our VA");
    await submit(owner, '[data-testid="team-invite"]');
    await owner.locator('[data-testid="team-invite-url"]').waitFor({ timeout: 20000 });
    const link = (await owner.locator('[data-testid="team-invite-url"]').innerText()).trim();
    const samCtx = await browser.newContext();
    const sam = await samCtx.newPage();
    watch(sam);
    await sam.goto(link);
    await sam.locator('[data-testid="team-join"]').waitFor({ timeout: 20000 });
    await sam.fill('input[name="firstName"]', "Sam");
    await sam.fill('input[name="lastName"]', "Vale");
    await sam.fill('input[name="email"]', samEmail);
    await sam.fill('input[name="password"]', PASSWORD);
    await sam.fill('input[name="confirm"]', PASSWORD);
    await Promise.all([sam.waitForURL(/\/today/, { timeout: 30000 }), sam.click('button:has-text("Join the team")')]);
    await sam.locator('[data-testid="team-home"]').waitFor({ timeout: 20000 });
    const samUser = (await db.query.users.findFirst({ where: eq(schema.users.email, samEmail) }))!;
    const samRow = (await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.teamUserId, samUser.id), isNull(schema.teamMembers.removedAt)) }))!;
    must(samRow, "Sam is on Maya's team");
    console.log("✓ Maya invites, Sam joins with his own login");

    // ── 2. Sam sees Office Hours and books for Maya. ──
    must(await sam.locator('[data-testid="team-home"] a[href="/office-hours"]').count(), "the team home has an Office Hours door");
    must(await sam.locator('nav a[href="/office-hours"]').count(), "the menu shows Office Hours to a team member");
    await sam.goto(`${base}/office-hours`);
    await sam.locator('[data-testid="ooh-form"]').first().waitFor({ timeout: 20000 });
    must((await sam.locator("h1").innerText()).includes("Office Hours"), "Office Hours opens for a team member");
    const attendeeIds = await sam.locator('[data-testid="ooh-form"]').first().locator('[data-testid="ooh-attendee"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-user")));
    must(attendeeIds.length === 2 && attendeeIds.includes(maya.id) && attendeeIds.includes(samUser.id), `the attendee list is exactly the owner and her team: ${attendeeIds.join(",")}`);
    must(await sam.locator('[data-testid="ooh-form"]').first().locator(`[data-testid="ooh-attendee"][data-user="${maya.id}"]`).isChecked(), "the owner is ticked by default");
    must(!(await sam.locator("main").innerText()).includes(privateWord), "Maya's own request is not on Sam's page");
    must((await sam.locator('[data-testid="ooh-mine"]').count()) === 0, "Sam is part of no request yet");
    const fill = async (page: Page, others: string) => {
      const form = page.locator('[data-testid="ooh-form"]').first();
      await form.locator('[data-testid="ooh-friday"]').selectOption(fridays[0]);
      await form.locator('[data-testid="ooh-description"]').fill(`Booked by Sam ${run}: the bot's booking link.`);
      await form.locator('[data-testid="ooh-tried"]').fill("Re-read the setup lesson together.");
      await form.locator('[data-testid="ooh-goal"]').fill("Bookings land on the right calendar.");
      await form.locator('[data-testid="ooh-category"]').selectOption({ index: 1 });
      await form.locator(`[data-testid="ooh-attendee"][data-user="${samUser.id}"]`).check();
      await form.locator('[data-testid="ooh-others"]').fill(others);
      await form.locator('[data-testid="ooh-gate-yes"]').check();
      await form.locator('[data-testid="ooh-promise"]').check();
    };
    // An email in the Others line is refused, nothing saved.
    await fill(sam, "Lee lee@example.com");
    await submit(sam, '[data-testid="ooh-submit"]');
    await sam.locator('[data-testid="ooh-error"]').waitFor({ timeout: 20000 });
    must((await sam.locator('[data-testid="ooh-error"]').innerText()).includes("Names only here"), "an email in Others is refused with the reason");
    must((await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.submittedByUserId, samUser.id) })).length === 0, "nothing was saved on the refusal");
    // The gate logs an allowed write at the door (src/lib/team.ts), the refused attempt included; the booking adds exactly one more.
    const changesBefore = (await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, samRow.id), eq(schema.teamChanges.kind, "change")) })).length;
    await sam.goto(`${base}/office-hours`);
    await sam.locator('[data-testid="ooh-form"]').first().waitFor({ timeout: 20000 });
    await fill(sam, "Lee");
    await submit(sam, '[data-testid="ooh-submit"]');
    await sam.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
    console.log("✓ a team member sees Office Hours, the attendee list is the owner and the team, an email in Others is refused, the booking goes through");

    // ── 3. The request is Maya's, submitted by Sam; no points; Sam sees only his. ──
    const req = (await db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.submittedByUserId, samUser.id) }))!;
    must(req && req.userId === maya.id && req.workspaceId === ws, "the request belongs to the owner's account");
    must(JSON.stringify([...req.attendeeUserIds].sort()) === JSON.stringify([maya.id, samUser.id].sort()) && req.attendeesOther === "Lee", `the attendees and the other name are stored: ${JSON.stringify(req.attendeeUserIds)} ${req.attendeesOther}`);
    must((await db.query.teamChanges.findMany({ where: and(eq(schema.teamChanges.teamMemberId, samRow.id), eq(schema.teamChanges.kind, "change")) })).length === changesBefore + 1, "one change row on Maya's team log for the booking");
    must((await db.query.pointsLedger.findMany({ where: eq(schema.pointsLedger.userId, maya.id) })).length === pointsBefore, "no points for a team-submitted request");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!.oohNotice?.requestId === req.id, "the owner's notice points at the request");
    const samText = await sam.locator("main").innerText();
    must((await sam.locator('[data-testid="ooh-mine"]').count()) === 1 && samText.includes(`Booked by Sam ${run}`) && !samText.includes(privateWord), "Sam sees his request and not Maya's own");
    must((await sam.locator('[data-testid="ooh-attending"]').first().innerText()) === `Attending: ${maya.name}, Sam Vale; others: Lee`, `the attendee line: ${await sam.locator('[data-testid="ooh-attending"]').first().innerText()}`);
    must((await sam.locator('[data-testid="ooh-submitted-by"]').first().innerText()) === "Submitted by Sam Vale", "the card says who submitted");
    must(await sam.locator('[data-testid="ooh-mine"] [data-testid="ooh-edit"]').count(), "the submitter can change it before the Friday");
    must(!samText.includes("Delete"), "a team member gets no delete");
    await sam.setViewportSize({ width: 390, height: 844 });
    await sam.goto(`${base}/office-hours`);
    await sam.locator('[data-testid="ooh-form"]').first().waitFor({ timeout: 20000 });
    const widths = await sam.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    must(widths.scroll <= widths.inner, `no sideways scroll at 390 px: ${widths.scroll} vs ${widths.inner}`);
    console.log("✓ the request is the owner's with Sam as its submitter, logged, no points; Sam sees only his; 390 px has no sideways scroll");

    // ── 4. Maya: the notice on Today and on Office Hours, both requests, the line cleared by opening. ──
    await owner.goto(`${base}/today`);
    await owner.locator('[data-testid="today-ooh-notice"]').waitFor({ timeout: 20000 });
    must((await owner.locator('[data-testid="today-ooh-notice"]').innerText()).includes("Sam Vale booked office hours for you"), "Today tells the owner who booked");
    await owner.goto(`${base}/office-hours`);
    await owner.locator('[data-testid="ooh-notice"]').waitFor({ timeout: 20000 });
    must((await owner.locator('[data-testid="ooh-notice"]').innerText()).includes("Sam Vale booked office hours for you"), "Office Hours carries the line");
    must((await owner.locator('[data-testid="ooh-mine"]').count()) === 2, "the owner sees both requests");
    const mayaText = await owner.locator("main").innerText();
    must(mayaText.includes(privateWord) && mayaText.includes("Submitted by Sam Vale") && mayaText.includes(`Attending: ${maya.name}, Sam Vale; others: Lee`), "the owner reads who submitted and who's attending");
    for (let i = 0; i < 20 && (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!.oohNotice; i++) await sleep(500);
    must(!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, mayaM.id) }))!.oohNotice, "opening Office Hours clears the notice");
    await owner.goto(`${base}/today`);
    await owner.locator("h1").first().waitFor({ timeout: 20000 });
    must(!(await owner.locator('[data-testid="today-ooh-notice"]').count()), "Today no longer carries the line");
    console.log("✓ the owner is told on Today and on Office Hours, sees both requests with who submitted and who's attending; opening clears the line");

    // ── 5. The coach's queue. ──
    const coachPage = await browser.newPage();
    watch(coachPage);
    await login(coachPage, "As the coach");
    await coachPage.goto(`${base}/coach/office-hours`);
    const card = coachPage.locator('[data-testid="ooh-request"]', { hasText: `Booked by Sam ${run}` });
    await card.waitFor({ timeout: 20000 });
    const cardText = await card.innerText();
    must(cardText.includes(maya.name) && cardText.includes("Submitted by Sam Vale") && cardText.includes(`Attending: ${maya.name}, Sam Vale; others: Lee`), `the coach's card names the member, the submitter and the attendees: ${cardText.slice(0, 200)}`);
    console.log("✓ the coach's queue shows the request under the owner with Submitted by and the attendees");

    // ── 5b. Office Hours by program level (H-470): the level's default, the coach's switch both ways, earned access, the team follows the owner. ──
    const { OOH_LOCKED_LINE } = await import("@/lib/engine/office-hours");
    const level = async (want: string) => {
      await coachPage.goto(`${base}/coach/${mayaM.id}`);
      await coachPage.locator('[data-testid="level-select"]').waitFor({ timeout: 20000 });
      await coachPage.locator('[data-testid="level-select"]').selectOption(want);
      await submit(coachPage, '[data-testid="level-save"]');
      await coachPage.waitForFunction((w) => (document.querySelector('[data-testid="level-select"]') as HTMLSelectElement | null)?.value === w, want, { timeout: 20000 });
    };
    const state = async () => {
      await coachPage.goto(`${base}/coach/${mayaM.id}`);
      const el = coachPage.locator('[data-testid="client-level"]');
      await el.waitFor({ timeout: 20000 });
      return { on: (await el.getAttribute("data-ooh")) === "on", reason: await el.getAttribute("data-ooh-reason"), words: (await coachPage.locator('[data-testid="ooh-switch-words"]').innerText()).trim() };
    };
    const menuHas = async (page: Page) => {
      await page.goto(`${base}/today`);
      await page.locator("h1").first().waitFor({ timeout: 20000 });
      return (await page.locator('nav a[href="/office-hours"]').count()) > 0;
    };
    // Maya opens the form while she still has access; the coach then moves her to Accelerator; her stale submit is refused on the server.
    await owner.goto(`${base}/office-hours`);
    await owner.locator('[data-testid="ooh-form"]').first().waitFor({ timeout: 20000 });
    await level("Accelerator");
    let st = await state();
    must(!st.on && st.reason === "locked" && st.words === "Following level (Accelerator)", `Accelerator follows its level: off (${JSON.stringify(st)})`);
    await fill(owner, "");
    await submit(owner, '[data-testid="ooh-submit"]');
    await owner.locator('[data-testid="ooh-error"]').waitFor({ timeout: 20000 });
    must((await owner.locator('[data-testid="ooh-error"]').innerText()).trim() === OOH_LOCKED_LINE, "the server refuses the stale form with the one plain line");
    const requestsAfter = (await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) })).length;
    must(requestsAfter === 2, `nothing new was saved: ${requestsAfter}`);
    must(!(await menuHas(owner)), "Accelerator: the menu has no Office Hours");
    must(!(await owner.locator('[data-testid="today-ooh-notice"]').count()), "and Today carries no Office Hours line");
    await owner.goto(`${base}/office-hours`);
    await owner.locator('[data-testid="ooh-locked"]').waitFor({ timeout: 20000 });
    must((await owner.locator('[data-testid="ooh-locked"]').innerText()).trim() === OOH_LOCKED_LINE && !(await owner.locator('[data-testid="ooh-form"]').count()) && !(await owner.locator('[data-testid="ooh-when"]').count()), "the page by address: the one line, no form, no prices");
    must((await owner.locator('[data-testid="ooh-mine"]').count()) === 2 && (await owner.locator("main").innerText()).includes(privateWord) && !(await owner.locator('[data-testid="ooh-edit"]').count()), "history stays readable, nothing editable");
    must(!(await owner.locator("main").innerText()).match(/\$\d|price/i), "no prices anywhere on the locked page");
    // The team follows the owner: no door, no menu item, history kept.
    must(!(await menuHas(sam)), "a team member of an Accelerator owner has no Office Hours in the menu");
    must(!(await sam.locator('[data-testid="team-home"] a[href="/office-hours"]').count()), "and no door on the team home");
    await sam.goto(`${base}/office-hours`);
    await sam.locator('[data-testid="ooh-locked"]').waitFor({ timeout: 20000 });
    must((await sam.locator('[data-testid="ooh-mine"]').count()) === 1, "the team member's past request stays readable");
    // The coach's queue marks the request; the coach always gets in.
    await coachPage.goto(`${base}/coach/office-hours`);
    await card.waitFor({ timeout: 20000 });
    must(await card.locator('[data-testid="ooh-off-mark"]').count(), "the coach's queue marks a request from a client who has no Office Hours now");
    await coachPage.goto(`${base}/office-hours`);
    await coachPage.locator('[data-testid="ooh-form"]').first().waitFor({ timeout: 20000 });
    // The switch on: an Accelerator client gets it; Set by you; the team's door is back.
    await coachPage.goto(`${base}/coach/${mayaM.id}`);
    await submit(coachPage, '[data-testid="ooh-switch"]');
    await coachPage.waitForFunction(() => document.querySelector('[data-testid="client-level"]')?.getAttribute("data-ooh") === "on", null, { timeout: 20000 });
    st = await state();
    must(st.on && st.reason === "set_on" && st.words === "Set by you" && (await coachPage.locator('[data-testid="ooh-reset"]').count()) === 1, `the switch on: ${JSON.stringify(st)}`);
    must(await menuHas(owner), "the switch on gives an Accelerator client the menu item");
    must(await menuHas(sam) && (await sam.locator('[data-testid="team-home"] a[href="/office-hours"]').count()) === 1, "and the team its door");
    await coachPage.goto(`${base}/coach/office-hours`);
    await card.waitFor({ timeout: 20000 });
    must(!(await card.locator('[data-testid="ooh-off-mark"]').count()), "the mark goes when access is back");
    // Reset to level: Accelerator again, off. The level to Academy: on by level. The switch off on Academy: off, Set by you. Reset: on.
    await coachPage.goto(`${base}/coach/${mayaM.id}`);
    await submit(coachPage, '[data-testid="ooh-reset"]');
    await coachPage.waitForFunction(() => document.querySelector('[data-testid="client-level"]')?.getAttribute("data-ooh") === "off", null, { timeout: 20000 });
    st = await state();
    must(!st.on && st.reason === "locked" && st.words === "Following level (Accelerator)", `reset to level: ${JSON.stringify(st)}`);
    await level("Academy");
    st = await state();
    must(st.on && st.reason === "level" && st.words === "Following level (Academy)", `a level change with no override follows the new level: ${JSON.stringify(st)}`);
    await submit(coachPage, '[data-testid="ooh-switch"]');
    await coachPage.waitForFunction(() => document.querySelector('[data-testid="client-level"]')?.getAttribute("data-ooh") === "off", null, { timeout: 20000 });
    st = await state();
    must(!st.on && st.reason === "set_off" && st.words === "Set by you", `the switch off on Academy: ${JSON.stringify(st)}`);
    must(!(await menuHas(owner)), "off by the switch: the menu item is gone for an Academy client");
    await level("Luxe");
    st = await state();
    must(!st.on && st.reason === "set_off", "with an override the override holds across a level change");
    await submit(coachPage, '[data-testid="ooh-reset"]');
    await coachPage.waitForFunction(() => document.querySelector('[data-testid="client-level"]')?.getAttribute("data-ooh") === "on", null, { timeout: 20000 });
    // Earned access: a fulfilled 30-day reward opens it for an Accelerator client, then expires.
    await level("Accelerator");
    const claimId = newId();
    await db.insert(schema.rewardClaims).values({ id: claimId, workspaceId: ws, userId: maya.id, rewardName: "30 Days Access to Evolve Omega Academy", status: "fulfilled", fulfilledAt: new Date().toISOString() });
    st = await state();
    must(st.on && st.reason === "earned" && (await coachPage.locator('[data-testid="ooh-access-words"]').innerText()).includes("earned access until"), `earned access opens it: ${JSON.stringify(st)}`);
    must(await menuHas(owner), "earned access shows the menu item");
    await db.update(schema.rewardClaims).set({ fulfilledAt: new Date(Date.now() - 40 * 86400000).toISOString() }).where(eq(schema.rewardClaims.id, claimId));
    st = await state();
    must(!st.on && st.reason === "locked", "and it closes once the 30 days are over");
    const logged = await db.query.syncEvents.findMany({ where: and(eq(schema.syncEvents.userId, maya.id), eq(schema.syncEvents.provider, "account")) });
    must(logged.filter((l) => l.event.startsWith("office_hours.")).length >= 4 && logged.some((l) => l.event === "program_tier.set"), `every flip and level change is logged as the coach's action: ${logged.map((l) => l.event).join(",")}`);
    must(!logged.some((l) => JSON.stringify(l.payload ?? "").includes("@")), "the log carries no email address");
    // Back to the seed's shape for the walks after this one.
    await db.delete(schema.rewardClaims).where(eq(schema.rewardClaims.id, claimId));
    await level("Elite");
    st = await state();
    must(st.on && st.reason === "level", "Elite: on by level again");
    console.log("✓ Office Hours by level: Accelerator off with the one plain line and history kept, the team follows the owner, the coach's switch both ways and Reset to level, a level change honours an override, earned access opens then expires, the coach always gets in, every change logged");

    // ── 6. Maya removes Sam: the request stays, Sam reads as a former team member. ──
    await owner.goto(`${base}/settings`);
    await owner.locator('[data-testid="team-member"]', { hasText: "Sam Vale" }).locator('[data-testid="team-remove"]').click();
    await submit(owner, '[data-testid="confirm-delete-yes"]:visible');
    must((await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, samRow.id) }))!.removedAt, "Sam is removed");
    must(await db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.id, req.id) }), "the request stays");
    await owner.goto(`${base}/office-hours`);
    await owner.locator('[data-testid="ooh-mine"]').first().waitFor({ timeout: 20000 });
    const afterText = await owner.locator("main").innerText();
    must(afterText.includes("Submitted by Sam Vale (former team member)") && afterText.includes(`Attending: ${maya.name}, Sam Vale (former team member); others: Lee`), "a removed team member reads as former on the owner's card");
    await coachPage.goto(`${base}/coach/office-hours`);
    await card.waitFor({ timeout: 20000 });
    must((await card.innerText()).includes("Sam Vale (former team member)"), "and on the coach's");
    await samCtx.close();
    await coachPage.close();
    await owner.close();
    console.log("✓ removing the team member keeps the request and marks them a former team member");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Office Hours team smoke passed");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
