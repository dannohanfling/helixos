/**
 * The weekly calls (H-820, plan H-828), at runtime, against the running dev server:
 *  1. The coach's Settings → Calls shows the usual week (read from DEFAULT_CALLS, in its order) with who each call is for, the
 *     shared link and the passcode. The coach moves one call's start, skips a date and undoes it, and changes the passcode.
 *  2. The client (Maya, Elite in the seed) opens Calls: this week's calls in start order, exactly the ones the engine computes
 *     for her level from the database, no length or end time on any of them (H-836), each Join greyed with "Join opens at"
 *     until its window, the passcode with Copy, and Add to calendar answering text/calendar with RRULE. A call id from nowhere is not found.
 *  3. A call that started this minute (a fixture, placed so no other call cuts its live window short): Live now at the top
 *     with Join live to the shared link, and Today's Next call line live with Join and the passcode, with no length or end.
 *  4. At the Accelerator level (H-865): the Accelerator calls to join, and the Academy calls listed greyed in time order, marked
 *     "Academy members", with no Join, Add to calendar or sales line; their calendar files are not found, and Today never
 *     names one.
 *  5. At 390 px Calls has no sideways scroll and every Join and Add to calendar is a 44 px tap target.
 *  6. The coach's Calls page shows every call with who it is for.
 */
import { chromium, type Browser, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, scope: ReturnType<Page["locator"]>, selector: string) {
  const button = scope.locator(selector).first();
  await button.waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
async function fillIn(scope: ReturnType<Page["locator"]>, selector: string, value: string) {
  const box = scope.locator(selector).first();
  await box.fill(value);
  if ((await box.inputValue()) !== value) await box.fill(value);
  if ((await box.inputValue()) !== value) throw new Error(`${selector} did not take the value typed into it`);
}
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { DEFAULT_CALLS, CALL_AUDIENCE_LABEL, LIVE_HOURS, LOCKED_LABEL, callOccurrences, listedWeek } = await import("@/lib/engine/calls");

  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = mayaM.workspaceId;
  const fixtureId = newId();
  try {
    // ── 1. The coach's card. ──
    const coach = await browser.newPage();
    watch(coach);
    await login(coach, "As the coach");
    await coach.goto(`${base}/settings#calls`);
    const card = coach.locator("#calls");
    await card.locator('[data-testid="calls-row"]').first().waitFor({ timeout: 30000 });
    const rows = card.locator('[data-testid="calls-row"]');
    must((await rows.count()) === DEFAULT_CALLS.length, `the card lists the ${DEFAULT_CALLS.length} usual calls: ${await rows.count()}`);
    const names = await card.locator('[data-testid="calls-row-name"]').allInnerTexts();
    must(JSON.stringify(names) === JSON.stringify(DEFAULT_CALLS.map((c) => c.name)), `in the coach's order: ${names.join(", ")}`);
    const audiences = await card.locator('[data-testid="calls-row-audience"]').allInnerTexts();
    must(JSON.stringify(audiences) === JSON.stringify(DEFAULT_CALLS.map((c) => CALL_AUDIENCE_LABEL[c.audience])), `each with who it is for: ${audiences.join(", ")}`);
    const wsRow = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws) }))!;
    must(wsRow.callsLink && (await card.locator('[data-testid="calls-link"]').inputValue()) === wsRow.callsLink, "the shared link is the workspace's");
    must(wsRow.callsPasscode && (await card.locator('[data-testid="calls-passcode"]').inputValue()) === wsRow.callsPasscode, "the passcode is the workspace's");
    console.log(`✓ Settings → Calls lists the usual week (${DEFAULT_CALLS.length} calls) in order with their audiences, the shared link and the passcode`);

    // Move the first call's start.
    const first = rows.first();
    const firstId = (await first.getAttribute("data-call"))!;
    await first.locator('[data-testid="calls-edit-open"]').click();
    await fillIn(first, '[data-testid="call-edit-form"] [data-testid="call-start"]', "10:30");
    await submit(coach, first, '[data-testid="call-save"]');
    must((await db.query.programCalls.findFirst({ where: eq(schema.programCalls.id, firstId) }))!.start === "10:30", "the call's start is saved");
    const moved = card.locator(`[data-testid="calls-row"][data-call="${firstId}"] [data-testid="calls-row-when"]`);
    await moved.waitFor({ timeout: 20000 });
    must((await moved.innerText()).includes("10:30"), `the row says the new time: ${await moved.innerText()}`);
    // A bad time is refused with the reason, and nothing changes.
    const again = card.locator(`[data-testid="calls-row"][data-call="${firstId}"]`);
    if (!(await again.locator('[data-testid="call-edit-form"]').isVisible())) await again.locator('[data-testid="calls-edit-open"]').click();
    await fillIn(again, '[data-testid="call-edit-form"] [data-testid="call-timezone"]', "Mars/Olympus");
    await submit(coach, again, '[data-testid="call-save"]');
    await card.locator('[data-testid="calls-error"]').waitFor({ timeout: 20000 });
    must((await card.locator('[data-testid="calls-error"]').innerText()).includes("isn't a timezone"), "the refusal says why");
    must((await db.query.programCalls.findFirst({ where: eq(schema.programCalls.id, firstId) }))!.timezone === "America/Los_Angeles", "an unknown zone is refused and nothing changes");
    console.log("✓ the coach moves a call to 10:30, and an unknown time zone is refused with the reason");

    // Skip a date and undo it.
    await coach.goto(`${base}/settings#calls`);
    const skipRow = card.locator(`[data-testid="calls-row"][data-call="${firstId}"]`);
    await skipRow.waitFor({ timeout: 20000 });
    await skipRow.locator('[data-testid="calls-skip-open"]').click();
    const date = await skipRow.locator('[data-testid="calls-skip-date"]').inputValue();
    await fillIn(skipRow, '[data-testid="calls-skip-note"]', "Holiday");
    await submit(coach, skipRow, '[data-testid="calls-skip"]');
    const skip = await db.query.programCallSkips.findFirst({ where: and(eq(schema.programCallSkips.callId, firstId), eq(schema.programCallSkips.date, date)) });
    must(skip?.note === "Holiday", `the skip is saved for ${date}`);
    const skipLine = card.locator(`[data-testid="calls-row"][data-call="${firstId}"] [data-testid="calls-skip"][data-date="${date}"]`);
    await skipLine.waitFor({ timeout: 20000 });
    must((await skipLine.innerText()).startsWith("No call on"), `the row says so: ${await skipLine.innerText()}`);
    await submit(coach, skipLine, '[data-testid="calls-unskip"]');
    must(!(await db.query.programCallSkips.findFirst({ where: eq(schema.programCallSkips.id, skip!.id) })), "Undo removes the skip");
    console.log(`✓ the coach skips ${date} ("No call on …", Holiday) and undoes it`);

    // Change the passcode.
    const passcode = `evolve${Math.floor(Math.random() * 900 + 100)}`;
    await coach.goto(`${base}/settings#calls`);
    const shared = coach.locator('[data-testid="calls-shared"]');
    await shared.waitFor({ timeout: 20000 });
    await fillIn(shared, '[data-testid="calls-passcode"]', passcode);
    await submit(coach, shared, '[data-testid="calls-shared-save"]');
    must((await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, ws) }))!.callsPasscode === passcode, "the passcode is saved");
    console.log("✓ the coach changes the passcode");

    // ── 2. The client's week. ──
    const client = await browser.newPage();
    watch(client);
    await login(client, "As a client");
    const expected = async (tier: string) => {
      const calls = await db.query.programCalls.findMany({ where: eq(schema.programCalls.workspaceId, ws) });
      const skips = await db.query.programCallSkips.findMany();
      const now = new Date();
      return callOccurrences(calls, skips, now, new Date(now.getTime() + 7 * 86_400_000), undefined, { role: "client", programTier: tier });
    };
    const want = await expected(mayaM.programTier);
    await client.goto(`${base}/calls`);
    await client.locator('[data-testid="calls-item"]').first().waitFor({ timeout: 30000 });
    const items = client.locator('[data-testid="calls-item"]');
    const starts = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-start") ?? ""));
    must(starts.length === want.length, `Calls lists the ${want.length} calls of the next seven days for ${mayaM.programTier}: ${starts.length}`);
    const live = await client.locator('[data-testid="calls-live"] [data-testid="calls-item"]').count();
    must(JSON.stringify(starts.slice(live)) === JSON.stringify([...starts.slice(live)].sort()), "in start order");
    must(JSON.stringify([...starts].sort()) === JSON.stringify(want.map((o) => o.startIso).sort()), "the same calls the engine computes");
    // No length and no end time anywhere a member reads a call (H-836: calls often run long).
    const weekText = await client.locator("main").innerText();
    must(!/\b\d+ (min|h)\b/.test(weekText) && !/\d:\d{2}\s*[AP]M\s*[-–]\s*\d/.test(weekText), "no call shows a length or an end time");
    const later = client.locator('[data-testid="calls-item"][data-state="later"] [data-testid="call-join"]').first();
    must(await later.isDisabled(), "a later call's Join is greyed");
    must((await later.innerText()).startsWith("Join opens at"), `and says when it opens: ${await later.innerText()}`);
    must((await client.locator('[data-testid="calls-passcode-value"]').innerText()) === passcode, "the passcode is the coach's new one");
    must(await client.locator('[data-testid="calls-passcode-copy"]').isVisible(), "with a Copy button");
    const callId = (await items.first().getAttribute("data-call"))!;
    const ics = await client.request.get(`${base}/calls/${callId}/calendar`);
    const icsText = await ics.text();
    must(ics.status() === 200 && (ics.headers()["content-type"] ?? "").startsWith("text/calendar"), `Add to calendar answers text/calendar: ${ics.status()}`);
    must(icsText.includes("RRULE:FREQ=WEEKLY") && icsText.includes("DTSTART;TZID=") && icsText.includes(`Passcode: ${passcode}`), "a weekly event in the call's zone with the passcode");
    must((await client.request.get(`${base}/calls/${newId()}/calendar`)).status() === 404, "a call id from nowhere is not found");
    console.log(`✓ the client's Calls: ${starts.length} calls in order, Join greyed with "Join opens at", the passcode with Copy, Add to calendar is a weekly text/calendar`);

    // ── 3. A call that is live now. ──
    // The fixture starts this minute, in UTC. A live call lasts until two hours after its start or the next call Maya can see
    // (H-836), so if another call starts within three minutes the walk waits for it and starts the fixture after it.
    const p = (n: number) => String(n).padStart(2, "0");
    let fixture: Awaited<ReturnType<typeof expected>>[number] | undefined;
    for (let i = 0; i < 4 && !fixture; i++) {
      const t = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      await db.delete(schema.programCalls).where(eq(schema.programCalls.id, fixtureId));
      await db.insert(schema.programCalls).values({ id: fixtureId, workspaceId: ws, name: "Walk live call", weekday: t.getUTCDay(), start: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`, minutes: 60, timezone: "UTC", audience: "academy", link: null, active: true, sort: 99 });
      const occ = (await expected(mayaM.programTier)).find((o) => o.call.id === fixtureId);
      const left = occ ? new Date(occ.liveEndIso).getTime() - Date.now() : 0;
      if (occ && left > 3 * 60_000) fixture = occ;
      else await new Promise((r) => setTimeout(r, Math.max(left, 0) + 61_000));
    }
    must(fixture, "a live fixture call could be placed");
    must(new Date(fixture!.liveEndIso).getTime() <= new Date(fixture!.startIso).getTime() + LIVE_HOURS * 3_600_000, "its live end is at most two hours after the start");
    await client.goto(`${base}/calls`);
    const liveItem = client.locator(`[data-testid="calls-live"] [data-testid="calls-item"][data-call="${fixtureId}"]`);
    await liveItem.waitFor({ timeout: 30000 });
    must(await liveItem.locator('[data-testid="call-live"]').isVisible(), "Live now on the live call");
    const join = liveItem.locator('[data-testid="call-join"]');
    must((await join.evaluate((e) => e.tagName)) === "A" && (await join.getAttribute("href")) === wsRow.callsLink && (await join.getAttribute("target")) === "_blank", "Join is live, to the shared link, in a new tab");
    const order = await client.evaluate(() => {
      const a = document.querySelector('[data-testid="calls-live"]');
      const b = document.querySelector('[data-testid="calls-week"]');
      return !b || Boolean(a && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    must(order, "the live call sits above the week");
    await client.goto(`${base}/today`);
    const todayLine = client.locator('[data-testid="today-next-call"]');
    await todayLine.waitFor({ timeout: 30000 });
    must((await todayLine.getAttribute("data-state")) === "live", "Today's Next call line is live");
    const lineText = await todayLine.locator('[data-testid="today-next-call-line"]').innerText();
    must(/^📅 Next call: .+, \w{3} \d{1,2}:\d{2} [AP]M \(live now\)$/.test(lineText.trim()), `and says so, with no length or end: ${lineText}`);
    must(await todayLine.locator('[data-testid="call-join"]').isVisible(), "with Join");
    must((await todayLine.locator('[data-testid="today-next-call-passcode"]').innerText()).includes(passcode), "and the passcode");
    must((await todayLine.locator('[data-testid="today-next-call-week"]').getAttribute("href")) === "/calls", "See this week goes to Calls");
    console.log("✓ a call that started this minute: Live now at the top of Calls with Join live, and Today's Next call line with Join and the passcode");

    // ── 4. The Accelerator level: their own calls to join, the Academy calls listed greyed with nothing to press (H-865). ──
    await db.update(schema.memberships).set({ programTier: "Accelerator" }).where(eq(schema.memberships.id, mayaM.id));
    const wantAcc = await expected("Accelerator");
    must(wantAcc.length > 0 && wantAcc.every((o) => o.audience === "accelerator_academy"), "the engine gives the Accelerator calls only to join");
    const accWeek = await (async () => {
      const calls = await db.query.programCalls.findMany({ where: eq(schema.programCalls.workspaceId, ws) });
      const skips = await db.query.programCallSkips.findMany();
      const now = new Date();
      return listedWeek(calls, skips, now, new Date(now.getTime() + 7 * 86_400_000), { link: null, passcode: null }, { role: "client", programTier: "Accelerator" });
    })();
    const wantLocked = accWeek.filter((w) => w.listed === "locked");
    must(wantLocked.length > 0 && wantLocked.every((w) => w.occ.audience === "academy"), "the engine lists the Academy calls locked");
    await client.goto(`${base}/calls`);
    await client.locator('[data-testid="calls-item"]').first().waitFor({ timeout: 30000 });
    const accAud = await client.locator('[data-testid="calls-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-audience")));
    must(accAud.length === wantAcc.length && accAud.every((a) => a === "accelerator_academy"), `an Accelerator member can join the ${wantAcc.length} Accelerator calls and no Academy call: ${accAud.join(", ")}`);
    const locked = client.locator('[data-testid="calls-locked"]');
    const lockedRows = await locked.evaluateAll((els) =>
      els.map((e) => ({
        audience: e.getAttribute("data-audience"),
        disabled: e.getAttribute("aria-disabled"),
        label: e.querySelector('[data-testid="calls-locked-label"]')?.textContent?.trim() ?? "",
        controls: e.querySelectorAll("a, button, [data-testid='call-join'], [data-testid='calls-calendar']").length,
        opacity: Number(getComputedStyle(e).opacity),
        live: Boolean(e.closest('[data-testid="calls-live"]')),
      })),
    );
    must(lockedRows.length === wantLocked.length, `the ${wantLocked.length} Academy calls of the week are listed: ${lockedRows.length}`);
    must(lockedRows.every((r) => r.audience === "academy" && r.disabled === "true" && r.label === LOCKED_LABEL.academy && r.opacity < 1), `each greyed and marked "${LOCKED_LABEL.academy}": ${JSON.stringify(lockedRows.slice(0, 2))}`);
    must(lockedRows.every((r) => r.controls === 0 && !r.live), "none has Join, Add to calendar or any other control, and none is under Live now");
    const accText = await client.locator("main").innerText();
    must(!/upgrade|unlock|upsell|join (the )?academy|become an academy/i.test(accText), "no sales line anywhere on the page");
    const weekStarts = await client.locator('[data-testid="calls-week"] [data-start]').evaluateAll((els) => els.map((e) => e.getAttribute("data-start") ?? ""));
    must(weekStarts.length > 0 && JSON.stringify(weekStarts) === JSON.stringify([...weekStarts].sort()), "the locked calls sit in time order among the member's own");
    for (const w of wantLocked.slice(0, 2)) must((await client.request.get(`${base}/calls/${w.occ.call.id}/calendar`)).status() === 404, "an Academy call's calendar file is not found at Accelerator");
    must((await client.request.get(`${base}/calls/${fixtureId}/calendar`)).status() === 404, "nor the fixture's");
    // Today's Next call line never names a locked call.
    await client.goto(`${base}/today`);
    await client.locator("main").first().waitFor({ timeout: 30000 });
    const todayCall = await client.locator('[data-testid="today-next-call"]').getAttribute("data-call", { timeout: 2000 }).catch(() => null);
    if (todayCall) must((await db.query.programCalls.findFirst({ where: eq(schema.programCalls.id, todayCall) }))?.audience === "accelerator_academy", "Today's Next call is one the member can join");
    await db.update(schema.memberships).set({ programTier: mayaM.programTier }).where(eq(schema.memberships.id, mayaM.id));
    console.log(`✓ at Accelerator: ${accAud.length} Accelerator calls to join, ${lockedRows.length} Academy calls greyed as "${LOCKED_LABEL.academy}" with nothing to press and no sales line, their calendar files not found, Today never names one`);

    // ── 5. A phone. ──
    await client.setViewportSize({ width: 390, height: 844 });
    await client.goto(`${base}/calls`);
    await client.locator('[data-testid="calls-item"]').first().waitFor({ timeout: 30000 });
    await client.waitForTimeout(400);
    const widths = await client.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    must(widths.scroll <= widths.inner, `no sideways scroll at 390 px: ${widths.scroll} vs ${widths.inner}`);
    const heights = await client.locator('[data-testid="call-join"], [data-testid="calls-calendar"], [data-testid="calls-passcode-copy"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    must(heights.length > 0 && heights.every((h) => h >= 44), `every Join, Add to calendar and Copy is 44 px tall: ${heights.map(Math.round).join(", ")}`);
    console.log(`✓ 390 px: no sideways scroll, ${heights.length} tap targets at 44 px or more`);

    // ── 6. The coach's view. ──
    await coach.goto(`${base}/calls`);
    await coach.locator('[data-testid="calls-item"]').first().waitFor({ timeout: 30000 });
    const coachItems = await coach.locator('[data-testid="calls-item"]').count();
    const coachAud = await coach.locator('[data-testid="calls-item-audience"]').count();
    must(coachItems > 0 && coachItems === coachAud, `the coach sees every call with who it is for: ${coachItems} calls, ${coachAud} labels`);
    console.log("✓ the coach's Calls shows every call with its audience");

    await client.close();
    await coach.close();
    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Calls smoke passed");
  } finally {
    await db.delete(schema.programCalls).where(eq(schema.programCalls.id, fixtureId));
    await db.update(schema.memberships).set({ programTier: mayaM.programTier }).where(eq(schema.memberships.id, mayaM.id));
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
