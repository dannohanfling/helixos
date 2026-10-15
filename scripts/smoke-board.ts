/**
 * My Board (revs 664, 698), slice 1, as Maya with her AI key against scripts/mock-ai.ts: the hours asked on first use; a Board
 * question played back in the Boardroom in seat order (about 3.4s a speaker, the rows appearing as each speaks, a tapped seat
 * stopping it, reduced motion, the keyboard, 1440/1024/390 wide), with the server's checks visible (a figure she never gave and a claim to be Danno left out, a
 * weekend step moved to a working day, a step dropped to fit her hours); "The Board used" naming what was read; a Focus
 * follow-up from one advisor; the decision log; the coach's Danno principles (seeded from the pack, a price refused, a
 * new one reaching the next answer's prompt); the Edge Preset on the coach's own Board only; the same Board by voice; and a team
 * member refused.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
async function press(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST", { timeout: 60000 }), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { and, desc, eq, inArray, isNull } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { principlesFromPack, SEATS, MODES, MODE_INFO, SPEAK_MS } = await import("@/lib/engine/board");
    const { MIN_TURN_MS, MAX_TURN_MS, turnMs } = await import("@/lib/engine/board-view");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = m.workspaceId;
    for (const u of [maya.id, coachU.id]) {
      await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, u)));
      await db.insert(schema.aiCredentials).values({ id: newId(), workspaceId: ws, userId: u, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
    }
    await db.update(schema.memberships).set({ boardHours: null }).where(eq(schema.memberships.id, m.id));
    // Set it up for me (rev 660): Odette is in her DMs with the longest-overdue follow-up, and this week's 3-1-3 is already set.
    const { viewerFor } = await import("@/lib/auth");
    const today = (await viewerFor(maya.id, ws))!.today;
    const { weekOf } = await import("@/lib/engine/intentions");
    const { addDays } = await import("@/lib/dates");
    const overdue = addDays(today, -30);
    await db.insert(schema.contacts).values({ id: newId(), workspaceId: ws, userId: maya.id, name: "Odette Lane", stage: "conversation", nextFollowUpAt: overdue });
    await db.delete(schema.weeklyIntentions).where(and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, weekOf(today))));
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId: ws, userId: maya.id, weekOf: weekOf(today), word: "Calm", keyResults: [{ text: "Sleep by 10", done: null }, { text: "Two walks", done: null }, { text: "One rest day", done: null }], initiative: "Evenings off", tasks: [] });
    const offersBefore = (await db.query.offers.findMany({ where: eq(schema.offers.userId, maya.id) })).length;
    const proofsBefore = (await db.query.proofs.findMany({ where: eq(schema.proofs.userId, maya.id) })).length;
    const oohBefore = (await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) })).length;
    // A webinar of her own (the seeded two are worked examples, which the Board never reads as hers).
    await db.insert(schema.webinars).values({ id: newId(), workspaceId: ws, userId: maya.id, title: "Spring Reset Workshop", status: "building" });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // First use: the hours.
    await login(page, "As a client");
    await page.goto(`${base}/my-board`);
    must(!(await page.locator('[data-testid="board-ask"]').count()), "no ask box before the hours are set");
    await page.locator('[data-testid="board-hours"]').fill("5");
    await press(page, '[data-testid="board-hours-save"]');
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.boardHours === 5, "the hours saved");
    console.log("✓ first use: the hours asked before anything else, then the ask box");

    // A Board question: the Boardroom plays it back in order, then the minutes, the steps and the checks.
    await page.locator('[data-testid="board-question"]').fill("Should I run a webinar this month or put the time into DMs?");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    const decisionId = page.url().split("/my-board/")[1].split(/[?#]/)[0];
    // Timed from the second speaker: the server's HTML already shows the first one speaking before the page is live in the
    // browser, so the first turn also holds however long a cold page takes to load.
    const t0 = Date.now();
    const heard: string[] = [];
    const at: number[] = [];
    const rowsWhile: number[] = [];
    while (Date.now() - t0 < 90000) {
      if (await page.locator('[data-testid="board-table-recommends"]').count()) break;
      const label = await page.locator('[data-testid="board-speaking"] .br-says-label').innerText().catch(() => "");
      const who = SEATS.find((x) => label === `${x.short.toUpperCase()} SAYS`)?.key;
      if (who && heard.at(-1) !== who) {
        heard.push(who);
        at.push(Date.now());
        rowsWhile.push(await page.locator('[data-testid^="board-minute-"]').count());
        must(await page.locator(`[data-testid="board-seat-${who}"].br-speaking`).count(), `${who}'s seat is the one speaking`);
        must((await page.locator(".br-seat.br-dim").count()) === 4, "the other four seats dim");
        must(!(await page.locator('[data-testid="board-steps"]').count()), "the steps wait until the discussion ends");
      }
      await page.waitForTimeout(250);
    }
    const took = Date.now() - (at[1] ?? t0);
    must(heard.join() === "danno,alex,jordan,riley,morgan", `the seats speak in order: ${heard.join()}`);
    must(rowsWhile.join() === "1,2,3,4,5", `each row appears as its advisor speaks, earlier rows staying: ${rowsWhile.join()}`);
    // H-245: each turn is 10 to 15 s by its quote's length; the four turns after the first add up inside those bounds.
    must(took > 4 * MIN_TURN_MS - 1000 && took < 4 * MAX_TURN_MS + 3000, `10 to 15 s a speaker: ${took} ms from the second speaker to the recommendation`);
    must((await page.locator('[data-testid="board-table-recommends"]').innerText()).startsWith("THE BOARD RECOMMENDS"), "the table ends on the recommendation");
    console.log(`✓ the Boardroom plays it back: ${heard.join(" → ")}, ${took} ms for the last four turns, rows appearing as each speaks, the recommendation last`);
    for (const x of SEATS) must(await page.locator(`[data-testid="board-minute-${x.key}"]`).count(), `the ${x.name} row in the minutes`);
    const danno = await page.locator('[data-testid="board-minute-danno"]').innerText();
    must(!/As Danno/i.test(danno) && danno.includes("Be painfully specific"), `the chair never claims to be Danno: ${danno}`);
    must((await page.locator('[data-testid^="board-minute-"] .br-ask').count()) === 5, "each advisor's question under their counsel");
    const morgan = await page.locator('[data-testid="board-minute-morgan"]').innerText();
    must(!morgan.includes("9,999"), "a figure she never gave is left out");
    const steps = page.locator('[data-testid="board-step"]');
    must((await steps.count()) === 2, `the steps cut to fit 5 hours: ${await steps.count()}`);
    must((await page.locator('[data-testid="board-hours-line"]').innerText()).includes("of the 5 h you set aside this week"), "the hours line beside the steps");
    const notes = await page.locator('[data-testid="board-notes"]').innerText();
    must(notes.includes('Jordan: dropped "Book three follow-up calls" so the steps fit your 5 hours a week') && notes.includes("a working day") && notes.includes("you didn't give"), `the server's changes are said: ${notes}`);
    const used = await page.locator('[data-testid="board-used"]').innerText();
    const d = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, decisionId) }))!;
    must(d.answer && d.used.length && d.used.every((u) => used.includes(u.label)) && used.includes("Offers") && used.includes("Webinars") && !used.includes("Energy"), `"The Board used" names what was read: ${used}`);
    must(d.answer!.steps.every((x) => ![0, 6].includes(new Date(`${x.by}T12:00:00Z`).getUTCDay())), "every step on a working day");
    must((await page.locator('[data-testid="board-you-decide"]').innerText()).startsWith("You decide"), "You decide");
    must((await page.locator('[data-testid="board-decision"]').innerText()).length > 0, "the decision line");
    console.log("✓ the minutes: five rows, Danno never claimed, a made-up figure left out, a weekend step moved, a step dropped for her hours, what it used named");

    // Set it up for me: the checklist under the steps; nothing changes until she approves; drafts and private only.
    const setup = page.locator('[data-testid="board-setup"]');
    await setup.waitFor({ timeout: 5000 });
    const kinds = await page.locator('[data-testid="board-setup-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    must(kinds.join() === "task,task,checkin,intention,office_hours,offer,followup", `the set-up, at most 7, in order: ${kinds.join()}`);
    const allNotes = await page.locator('[data-testid="board-notes"]').innerText();
    must(allNotes.includes("cash collected target of 9999: that number isn't one you gave") && allNotes.includes('"Zed": they aren\'t in your DMs') && allNotes.includes('"DM Sprint" has no price') && allNotes.includes("Jordan kept the set-up to 7 changes"), `what the set-up left out is said: ${allNotes}`);
    must((await page.locator('[data-testid="board-setup-item"][data-kind="intention"] [data-testid="board-setup-change"]').innerText()).includes("Calm: Sleep by 10; Two walks; One rest day"), "the 3-1-3 that exists shows before → after");
    must((await page.locator('[data-testid="board-setup-item"][data-kind="followup"] [data-testid="board-setup-change"]').innerText()).startsWith("Follow up "), "Odette's follow-up date that exists shows before → after");
    const ticks = await page.locator('[data-testid="board-setup"] input[type=checkbox]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
    must(ticks.join() === "true,true,true,false,false,true,false", `the changes and the Office Hours ask are never ticked for her: ${ticks.join()}`);
    must((await page.locator('[data-testid="board-setup-approve"]').innerText()).includes("Approve 4 selected"), "Approve 4 selected");
    const boardRef = `board:${decisionId}`;
    must(!(await db.query.tasks.findMany({ where: eq(schema.tasks.sourceRef, boardRef) })).length && (await db.query.offers.findMany({ where: eq(schema.offers.userId, maya.id) })).length === offersBefore, "nothing changes before she approves");
    await press(page, '[data-testid="board-setup-approve"]');
    must((await page.locator('[data-testid="board-setup-result"]').innerText()).includes("Set up 4 changes"), "set up 4");
    const made = await db.query.tasks.findMany({ where: eq(schema.tasks.sourceRef, boardRef) });
    const after = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, decisionId) }))!;
    const step1 = made.find((t) => t.id === after.stepTasks[0]);
    must(step1 && step1.urgency === "top3" && step1.dueDate === after.answer!.steps[0].by && step1.details?.includes("Done when:") && step1.details.includes("First 5 minutes:") && step1.details.includes(`/my-board/${decisionId}`), `step 1 a Top 3 task on its day, linked back: ${JSON.stringify(step1)}`);
    must(made.length === 3 && made.some((t) => t.title.startsWith("Board check-in:") && t.dueDate === after.answer!.steps.at(-1)!.by), `the steps and the check-in as tasks: ${made.map((t) => t.title).join(" | ")}`);
    const draftOffer = (await db.query.offers.findMany({ where: eq(schema.offers.userId, maya.id) })).find((o) => o.name === "DM Sprint");
    must(draftOffer && draftOffer.status === "draft" && draftOffer.botRole === "not_on_bot" && !draftOffer.price && draftOffer.notes?.startsWith("Draft from Board:"), `a draft offer, not live, not on the bot, no made-up price: ${JSON.stringify(draftOffer)}`);
    const priyaOf = async () => (await db.query.contacts.findFirst({ where: and(eq(schema.contacts.userId, maya.id), eq(schema.contacts.name, "Odette Lane")) }))!;
    must((await priyaOf()).nextFollowUpAt === overdue, "Odette's follow-up date she didn't tick is untouched");
    must((await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, weekOf(today))) }))!.word === "Calm", "the 3-1-3 she didn't tick is untouched");
    must((await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) })).length === oohBefore, "nothing sent to the coach she didn't tick");
    must((await page.locator('[data-testid="board-setup-done"]').count()) === 4, "each set-up item shows as done with its link");
    // Now the three she held back: the 3-1-3 swap, Odette's new date and the Office Hours ask (its read-back on the row).
    must((await page.locator('[data-testid="board-setup-item"][data-kind="office_hours"]').innerText()).includes("It goes to your coach") === false && (await page.locator('[data-testid="board-setup-item"][data-kind="office_hours"]').innerText()).includes("The question: Should I run a webinar"), "the Office Hours ask is read back on its row");
    await page.locator('[data-testid="board-setup-item"][data-kind="intention"] input').check();
    await page.locator('[data-testid="board-setup-item"][data-kind="office_hours"] input').check();
    await page.locator('[data-testid="board-setup-item"][data-kind="followup"] input').check();
    await press(page, '[data-testid="board-setup-approve"]');
    const priya = await priyaOf();
    must(priya.nextFollowUpAt && priya.nextFollowUpAt > today && (await db.query.tasks.findMany({ where: eq(schema.tasks.sourceRef, `contact:${priya.id}`) })).length === 1, "Odette's follow-up moved once ticked, with one task");
    must((await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.userId, maya.id), eq(schema.weeklyIntentions.weekOf, weekOf(today))) }))!.word === "Reach", "the 3-1-3 swapped once she ticked it");
    const ooh = await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) });
    must(ooh.length === oohBefore + 1 && ooh.some((o) => o.description.startsWith("Should I run a webinar") && o.category === "Offer Creation"), "the Office Hours ask sent through its own gate");
    must((await db.query.tasks.findMany({ where: eq(schema.tasks.sourceRef, boardRef) })).length === 3 && (await page.locator('[data-testid="board-setup-done"]').count()) === 7 && !(await page.locator('[data-testid="board-setup-approve"]').count()), "nothing set up twice; all seven done");
    console.log("✓ Set it up for me: seven at most, an invented number and person left out, nothing changes before Approve, the steps as tasks (step 1 Top 3), the check-in, a draft offer off the bot; the 3-1-3 swap, a moved follow-up and the Office Hours ask only when ticked");

    // ▶ Play again (H-245): the same session from the saved answer, no request leaving the page, the usage count unchanged; a
    // turn's length is 10 to 15 s by its quote; a tap on the quote holds the turn and a second tap goes on.
    const usageBefore = (await db.query.aiUsage.findMany()).length;
    const requests: string[] = [];
    const onRequest = (r: { method: () => string; url: () => string }) => { if (r.method() === "POST") requests.push(r.url()); };
    page.on("request", onRequest);
    const replayBtn = page.locator('[data-testid="board-replay"]');
    must((await replayBtn.innerText()).includes("Play again") && (await replayBtn.getAttribute("aria-label")) === "Play the discussion again", "the pill reads ▶ Play again with its label");
    await replayBtn.click();
    await page.locator('[data-testid="board-speaking"]').waitFor({ timeout: 5000 });
    const turn = Number(await page.locator('[data-testid="board-speaking"]').getAttribute("data-turn-ms"));
    const firstQuote = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, decisionId) }))!.answer!.advisors[0].text;
    must(turn >= MIN_TURN_MS && turn <= MAX_TURN_MS && turn === turnMs(firstQuote), `the first turn lasts 10 to 15 s by its quote: ${turn} ms for ${firstQuote.split(/\s+/).length} words`);
    await page.locator('[data-testid="board-speaking"]').click();
    must((await page.locator('[data-testid="board-held"]').count()) === 1 && (await page.locator('[data-testid="board-speaking"]').getAttribute("data-held")) === "1", "a tap on the quote holds the turn with a paused mark");
    const heldSays = await page.locator('[data-testid="board-speaking"] .br-says-label').innerText();
    await page.waitForTimeout(MAX_TURN_MS + 1500);
    must((await page.locator('[data-testid="board-speaking"] .br-says-label').innerText()) === heldSays, "a held turn stays past its length");
    await page.locator('[data-testid="board-speaking"]').click();
    must((await page.locator('[data-testid="board-held"]').count()) === 0, "a second tap goes on");
    await page.locator('[data-testid="board-table-recommends"]').waitFor({ timeout: 6 * MAX_TURN_MS + 5000 });
    page.off("request", onRequest);
    must(requests.length === 0, `Play again sends no request: ${requests.join(", ")}`);
    must((await db.query.aiUsage.findMany()).length === usageBefore, "the usage count never moves on Play again");
    console.log("✓ ▶ Play again replays from the saved answer with no request and no usage; 10 to 15 s turns by quote; a tap holds the turn, a tap goes on");

    // Play again, and tap a seat during it: the playback stops on that advisor; tap again for the whole Board.
    await page.locator('[data-testid="board-replay"]').click();
    await page.locator('[data-testid="board-speaking"]').waitFor({ timeout: 5000 });
    must(!(await page.locator('[data-testid="board-steps"]').count()), "Play again hides the steps until it ends");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    const spotLine = await page.locator('[data-testid="board-speaking"] .br-says-label').innerText();
    await page.waitForTimeout(SPEAK_MS + 600);
    must(spotLine === "MORGAN SAYS" && (await page.locator('[data-testid="board-speaking"] .br-says-label').innerText()) === "MORGAN SAYS", `a tapped seat stops the playback on that advisor: ${spotLine}`);
    must((await page.locator('[data-testid="board-seat-morgan"]').getAttribute("aria-pressed")) === "true" && (await page.locator('[data-testid="board-minute-morgan"]:not(.br-dim)').count()) === 1, "the spotlight on Morgan");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    must((await page.locator('[data-testid="board-table-recommends"]').count()) && (await page.locator('[data-testid="board-steps"]').count()), "tapping it again returns to the whole Board");
    console.log("✓ Run the discussion again; a seat tapped mid-playback stops it on that advisor, tapped again returns to the Board");

    // Every seat and tab reachable by keyboard.
    await page.goto(`${base}/my-board/${decisionId}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="board-seat-riley"]').waitFor({ state: "visible" });
    // From the ask box onward (the sidebar's links come before it): every tab and seat follows in order.
    await page.locator('[data-testid="board-question"]').click();
    const reached = new Set<string>(["board-question"]);
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
      if (id) reached.add(id);
    }
    const want = [...SEATS.map((x) => `board-seat-${x.key}`), ...MODES.map((x) => `board-mode-${x}`), "board-question", "board-look-day", "board-look-night"];
    must(want.every((x) => reached.has(x)), `every statue, tab and look by keyboard; missed ${want.filter((x) => !reached.has(x)).join(", ")}`);
    await page.locator('[data-testid="board-seat-alex"]').focus();
    await page.keyboard.press("Enter");
    must((await page.locator('[data-testid="board-speaking"] .br-says-label').innerText()) === "ALEX SAYS", "Enter on a seat spotlights it");
    console.log(`✓ the keyboard reaches every statue, all ${MODES.length} mode tabs and both looks; Enter on a statue spotlights it`);

    // Reduced motion: no lean, breathing or bars; the speaker keeps the glow and the others dim.
    const still = await (await browser.newContext({ viewport: { width: 1280, height: 950 }, reducedMotion: "reduce", storageState: await page.context().storageState() })).newPage();
    await still.goto(`${base}/my-board/${decisionId}?play=1`);
    await still.locator(".br-seat.br-speaking").waitFor({ timeout: 5000 });
    const motion = await still.evaluate(() => {
      const seat = document.querySelector(".br-seat.br-speaking")!;
      const live = getComputedStyle(seat.querySelector(".br-live")!);
      const glow = getComputedStyle(seat.querySelector(".br-glow")!);
      return { lean: live.animationName, leanShown: live.opacity, breathe: glow.animationName, glow: glow.opacity, bars: getComputedStyle(seat.querySelector(".br-eq i")!).animationName, dim: document.querySelectorAll(".br-seat.br-dim").length };
    });
    must(motion.lean === "none" && motion.leanShown === "0" && motion.breathe === "none" && motion.bars === "none", `reduced motion: nothing moves ${JSON.stringify(motion)}`);
    must(motion.glow === "1" && motion.dim === 4, `reduced motion: the speaker keeps the glow, the others dim ${JSON.stringify(motion)}`);
    await still.context().close();
    console.log("✓ reduced motion: no lean, breathing or bars; the speaker keeps the glow, the others dim");

    // The look: Golden hour or Night, the member's own and remembered.
    await page.goto(`${base}/my-board/${decisionId}`);
    const lookNow = await page.locator('[data-testid="board-room"]').getAttribute("data-look");
    const other = lookNow === "day" ? "night" : "day";
    await page.locator(`[data-testid="board-look-${other}"]`).click();
    must((await page.locator('[data-testid="board-room"]').getAttribute("data-look")) === other && (await page.locator(`[data-testid="board-photo-${other}"]`).isVisible()), "the toggle changes the look at once");
    await page.waitForTimeout(800);
    await page.reload();
    must((await page.locator('[data-testid="board-room"]').getAttribute("data-look")) === other, "the look is remembered");
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.sceneLook === other, "stored on her membership");
    console.log(`✓ Golden hour / Night: ${lookNow} to ${other} at once, remembered after a reload`);

    // Widths 1440, 1024 and 390, in both looks: nothing scrolls sideways; every statue's button sits on its chair (rev 738's
    // percentages), at least 44px; no plate over a face (8% to 40% down its statue); the tabletop words or, on a phone, the caption.
    const { CHAIRS } = await import("@/lib/engine/board-view");
    for (const width of [1440, 1024, 390]) {
      for (const k of ["day", "night"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/my-board/${decisionId}`);
        await page.locator(`[data-testid="board-look-${k}"]`).click();
        await page.locator('[data-testid="board-seat-riley"]').waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(200);
        // Plain rects from the page (a named helper inside evaluate would carry the bundler's __name with it).
        type R = { left: number; right: number; top: number; bottom: number; width: number; height: number };
        const raw = (await page.evaluate(
          (keys) =>
            JSON.stringify({
              sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              room: document.querySelector('[data-testid="board-room"]')!.getBoundingClientRect(),
              seats: keys.map((key) => ({ key, seat: document.querySelector(`[data-testid="board-seat-${key}"]`)!.getBoundingClientRect(), plate: document.querySelector(`[data-testid="board-plate-${key}"]`)!.getBoundingClientRect() })),
              table: getComputedStyle(document.querySelector(".br-table")!).display,
              caption: getComputedStyle(document.querySelector('[data-testid="board-caption"]')!).display,
            }),
          SEATS.map((x) => x.key),
        )) as string;
        const j = JSON.parse(raw) as { sideways: number; room: R; seats: { key: string; seat: R; plate: R }[]; table: string; caption: string };
        const rr = (x: R) => ({ l: x.left, r: x.right, t: x.top, b: x.bottom, w: x.width, h: x.height });
        const box = { sideways: j.sideways, room: rr(j.room), seats: j.seats.map((x) => ({ key: x.key, seat: rr(x.seat), plate: rr(x.plate) })), table: j.table, caption: j.caption };
        must(box.sideways <= 0, `${width}px ${k}: nothing scrolls sideways (${box.sideways}px)`);
        must(Math.abs(box.room.h / box.room.w - 944 / 1680) < 0.01, `${width}px ${k}: the room keeps the photo's shape`);
        box.seats.forEach((x, i) => {
          const g = CHAIRS[i];
          const cx = ((x.seat.l + x.seat.r) / 2 - box.room.l) / box.room.w * 100;
          const cy = ((x.seat.t + x.seat.b) / 2 - box.room.t) / box.room.h * 100;
          must(Math.abs(cx - (g.l + g.w / 2)) < 1 && Math.abs(cy - (g.t + g.h / 2)) < 1 && x.seat.w >= 44 && x.seat.h >= 44, `${width}px ${k}: ${x.key} on its chair ${JSON.stringify({ cx, cy, w: x.seat.w, h: x.seat.h })}`);
          // The face: from 8% to 40% of the statue's box (the box's top edge is the crown, above the face).
          const faceTop = box.room.t + ((g.t + 0.08 * g.h) / 100) * box.room.h;
          const faceBottom = box.room.t + ((g.t + 0.4 * g.h) / 100) * box.room.h;
          const faceL = box.room.l + (g.l / 100) * box.room.w;
          const faceR = faceL + (g.w / 100) * box.room.w;
          // How far the plate reaches into the face zone, in pixels: a brush of the hairline is fine, covering the face isn't.
          const overX = Math.min(x.plate.r, faceR) - Math.max(x.plate.l, faceL);
          const overY = Math.min(x.plate.b, faceBottom) - Math.max(x.plate.t, faceTop);
          must(!(overX > 0 && overY > 6), `${width}px ${k}: ${x.key}'s plate clear of the face (${overY.toFixed(1)}px into it) ${JSON.stringify({ plate: x.plate, faceTop, faceBottom })}`);
        });
        must(width > 760 ? box.table === "flex" && box.caption === "none" : box.table === "none" && box.caption !== "none", `${width}px: the words on the table, or under the room on a phone`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 950 });
    console.log("✓ 1440, 1024 and 390 wide in both looks: the room keeps its shape, every statue's button on its chair and at least 44px, no plate over a face, the caption on a phone");

    // Evening clips (H-150): in the Night look each speaker's clip plays over the still for their turn (WebM first, the MP4
    // beside it, the still as poster), one video at a time, that seat's CSS lean off, the table line naming the speaker; the
    // last turn over, no video and the still; a tap mid-playback moves the clip to that seat; reduced motion plays none.
    {
      const { CHAIR_CLIP_NAMES, CHAIR_KEYS } = await import("@/lib/engine/board-view");
      const nameOf = (key: string) => CHAIR_CLIP_NAMES[CHAIR_KEYS[SEATS.findIndex((x) => x.key === key)]];
      const shortOf = (key: string) => SEATS.find((x) => x.key === key)!.short.toUpperCase();
      type ClipInfo = { videos: number; name: string | null; webm: string | null; mp4: string | null; poster: string | null; paused: boolean | null; seat: string | null; clipped: boolean; lean: string | null; says: string; done: boolean };
      const read = async (): Promise<ClipInfo> =>
        JSON.parse(
          await page.evaluate(() => {
            const v = document.querySelector('[data-testid="board-clip"]') as HTMLVideoElement | null;
            const speaking = document.querySelector(".br-seat.br-speaking");
            return JSON.stringify({
              videos: document.querySelectorAll('[data-testid="board-clip"]').length,
              name: v?.getAttribute("data-name") ?? null,
              webm: v?.querySelector('source[type="video/webm"]')?.getAttribute("src") ?? null,
              mp4: v?.querySelector('source[type="video/mp4"]')?.getAttribute("src") ?? null,
              poster: v?.getAttribute("poster") ?? null,
              paused: v ? v.paused : null,
              seat: speaking?.getAttribute("data-testid") ?? null,
              clipped: Boolean(speaking?.classList.contains("br-clipped")),
              lean: speaking ? getComputedStyle(speaking.querySelector(".br-live")!).opacity : null,
              says: document.querySelector('[data-testid="board-speaking"] .br-says-label')?.textContent ?? "",
              done: !speaking,
            });
          }),
        ) as ClipInfo;
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/my-board/${decisionId}`);
        await page.locator('[data-testid="board-look-night"]').click();
        await page.waitForTimeout(400);
        await page.goto(`${base}/my-board/${decisionId}?play=1`);
        await page.locator('[data-testid="board-clip"]').waitFor({ timeout: 15000 });
        const seen = new Set<string>();
        let playing = 0;
        const deadline = Date.now() + 6 * SPEAK_MS + 5000;
        while (Date.now() < deadline) {
          const i = await read();
          if (i.videos) {
            const key = (i.seat ?? "").replace("board-seat-", "");
            must(i.videos === 1, `${width}px: one clip at a time (${i.videos})`);
            must(i.name === nameOf(key) && i.webm === `/board/council-night-${i.name}.webm` && i.mp4 === `/board/council-night-${i.name}.mp4` && i.poster === "/board/council-night.jpg", `${width}px: ${key}'s turn plays its own clip, WebM then MP4, the still as poster: ${JSON.stringify(i)}`);
            must(i.clipped && i.lean === "0", `${width}px: the CSS lean is off while ${key}'s clip plays: ${JSON.stringify({ clipped: i.clipped, lean: i.lean })}`);
            must(i.says === `${shortOf(key)} SAYS`, `${width}px: the table line names the speaker: ${i.says}`);
            if (i.paused === false) playing++;
            seen.add(key);
          }
          if (i.done && seen.size) break;
          await page.waitForTimeout(120);
        }
        must(SEATS.every((x) => seen.has(x.key)), `${width}px: every speaker's clip played in turn; saw ${[...seen].join(", ")}`);
        must(playing > 0, `${width}px: the clips were playing, not paused`);
        await page.waitForTimeout(300);
        const after = await read();
        must(after.videos === 0 && (await page.locator('[data-testid="board-photo-night"]').isVisible()), `${width}px: the last turn over, no video and the still: ${JSON.stringify(after)}`);
      }
      await page.setViewportSize({ width: 1280, height: 950 });
      // A tap mid-playback: the clip follows the spotlight to that seat, and a second tap returns to the Board and the still.
      await page.goto(`${base}/my-board/${decisionId}?play=1`);
      await page.locator('[data-testid="board-clip"]').waitFor({ timeout: 15000 });
      await page.locator('[data-testid="board-seat-riley"]').click({ force: true });
      await page.waitForTimeout(400);
      const tapped = await read();
      must(tapped.videos === 1 && tapped.name === "riley" && tapped.seat === "board-seat-riley", `a tap mid-playback moves the clip to that seat: ${JSON.stringify(tapped)}`);
      await page.locator('[data-testid="board-seat-riley"]').click({ force: true });
      await page.waitForTimeout(400);
      must((await read()).videos === 0, "a second tap returns to the Board and the still");
      // Reduced motion: no clip at all, the still and the glow as before.
      const quiet = await (await browser.newContext({ viewport: { width: 1280, height: 950 }, reducedMotion: "reduce", storageState: await page.context().storageState() })).newPage();
      await quiet.goto(`${base}/my-board/${decisionId}?play=1`);
      await quiet.locator(".br-seat.br-speaking").waitFor({ timeout: 5000 });
      await quiet.waitForTimeout(500);
      must((await quiet.locator('[data-testid="board-clip"], [data-testid="board-clip-next"]').count()) === 0 && (await quiet.locator('[data-testid="board-room"]').getAttribute("data-look")) === "night", "reduced motion: no clip plays and none preloads; the still stays");
      await quiet.context().close();
      console.log("✓ evening clips at 1440, 1024 and 390: each speaker's clip in turn over the still (WebM then MP4, the still as poster), one at a time, the lean off, the line naming the speaker; the still after; a tap moves the clip; reduced motion none");
    }

    // A Focus follow-up: only Morgan.
    await page.goto(`${base}/my-board/${decisionId}`);
    await page.locator('[data-testid="board-question"]').fill("What could go wrong with the DMs plan?");
    await page.locator('[data-testid="board-mode-focus"]').click();
    must((await page.locator('[data-testid="board-focus-hint"]').innerText()).includes("Tap the advisor"), "Focus asks which advisor");
    await page.locator('[data-testid="board-seat-morgan"]').click();
    must((await page.locator('[data-testid="board-focus-hint"]').innerText()).includes("You'll hear from Morgan"), "Focus names the advisor");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\?play=1/, { timeout: 60000 });
    const follow = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.parentId, decisionId) }))!;
    must(follow.answer?.advisors.map((a) => a.seat).join() === "morgan", `Focus hears one advisor: ${JSON.stringify(follow.answer?.advisors)}`);
    await page.locator('[data-testid="board-table-recommends"]').waitFor({ timeout: SPEAK_MS * 2 + 4000 });
    must((await page.locator('[data-testid^="board-minute-"]').count()) === 1 && (await page.locator('[data-testid="board-minute-morgan"]').count()), "the follow-up plays Morgan alone");
    must(await page.locator(`#d-${decisionId}`).count(), "the first answer under Earlier on this decision");
    await page.goto(`${base}/my-board`);
    must((await page.locator('[data-testid="board-decisions"]').innerText()).includes("1 follow-up"), "the decision log");
    console.log("✓ a Focus follow-up from Morgan only, on the same decision; the decision log lists it");

    // The coach's Danno: seeded from the pack, a price refused, a new principle reaching the next prompt.
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/board`);
    must((await page.locator('[data-testid="principle-title"]').count()) === principlesFromPack().length, "seeded from the pack");
    await page.locator('[data-testid="principle-new-title"]').fill("Price it high");
    await page.locator('[data-testid="principle-new-body"]').fill("Charge $5,000 for coaching.");
    await press(page, '[data-testid="principle-add"]');
    must((await page.locator('[data-testid="principle-error"]').innerText()).includes("No prices"), "a price is refused");
    await page.locator('[data-testid="principle-new-title"]').fill("Walk the floor");
    await page.locator('[data-testid="principle-new-body"]').fill("Spend an hour a week inside your client's day before you change the offer.");
    await page.locator('[data-testid="principle-new-goodfor"]').fill("Offers");
    await press(page, '[data-testid="principle-add"]');
    must((await page.locator('[data-testid="principle-title"]').count()) === principlesFromPack().length + 1, "added");

    // Edge Preset: the coach's own Board only.
    await db.update(schema.memberships).set({ boardHours: 6 }).where(and(eq(schema.memberships.userId, coachU.id), eq(schema.memberships.workspaceId, ws)));
    await page.goto(`${base}/my-board`);
    await page.locator("#hours-edit summary").click();
    await page.locator('[data-testid="board-preset"] select').selectOption("edge");
    await press(page, '[data-testid="board-preset"] button');
    await page.goto(`${base}/my-board`);
    await page.locator('[data-testid="board-question"]').fill("Should I launch a new program this quarter?");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    for (const k of ["tony", "dean", "igor", "jordan", "morgan"]) must(await page.locator(`[data-testid="board-seat-${k}"]`).count(), `the Edge seat ${k}`);
    must((await page.locator('[data-testid="board-plate-tony"]').innerText()).includes("Tony Robbins") && (await page.locator('[data-testid="board-seat-tony"]').getAttribute("style"))!.startsWith("left: 50.3%"), "the Edge Preset's names on the same chairs");
    const edgeNote = await page.locator('[data-testid="board-edge-note"]').innerText();
    must(edgeNote.includes("Tony Robbins, Dean Graziosi, Igor Pogany sit as style advisors") && edgeNote.includes("aren't the people"), `the Edge Preset says what its seats are: ${edgeNote}`);
    const last = (await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] };
    const sys = last.system.map((b) => b.text).join("\n");
    must(sys.includes("Walk the floor") && sys.includes("never claim to be them"), "the new principle and the Edge rules reach the prompt");
    console.log("✓ Danno: seeded from the pack, a price refused, a new principle in the next prompt; Edge Preset on the coach's own Board");

    // Maya's Board is never Edge, whatever is stored.
    await db.update(schema.memberships).set({ boardPreset: "edge" }).where(eq(schema.memberships.id, m.id));
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/my-board`);
    must(!(await page.locator('[data-testid="board-preset"]').count()) && (await page.locator('[data-testid="board-seat-danno"]').count()) && !(await page.locator('[data-testid="board-seat-tony"]').count()), "a client sees the standard five and no preset");

    // By voice, and a team member refused.
    const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
    const { createHash, randomBytes } = await import("node:crypto");
    const v = (await viewerFor(maya.id, ws))!;
    const client = await registerClient("Walk board", [CALLBACK]);
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["board"] as never });
    const pair = (await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string };
    // connection: close. Between two calls the walk imports the tool registry (seconds); the server drops an idle kept-alive
    // socket after five, and a request sent on it fails with "other side closed" (14 Oct). One connection per call, no race.
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await (await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${pair.access_token}`, "mcp-protocol-version": "2025-06-18", connection: "close" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
      return { text: res.result?.content?.[0]?.text ?? "", isError: Boolean(res.result?.isError) };
    };
    const r = await call("board_ask", { decision: "Should I post daily or three times a week?" });
    must(!r.isError && r.text.startsWith("The Board recommends: ") && r.text.includes("Your action steps:\n1. "), `voice: the recommendation first, the steps numbered: ${r.text.slice(0, 160)}`);
    must((await call("decisions_list", {})).text.includes("Should I post daily"), "voice: the list");
    const { allTools } = await import("@/lib/mcp/registry");
    await import("@/lib/mcp/tools");
    const team = { ...v, team: { teamMemberId: "walk", ownerMembershipId: m.id, ownerName: maya.name, teamName: "Walk VA" } };
    const refused = await allTools().find((t) => t.name === "board_ask")!.handler(team, { decision: "x x x" }).then(() => "ok", (e: Error) => e.message);
    must(refused.startsWith("A team member can read the Board's decisions but can't ask it"), `a team member is refused: ${refused}`);
    console.log("✓ by voice: the recommendation first, the steps numbered; a team member can't ask");

    // board_apply: the read-back first and nothing changes; then the yes. The Focus follow-up lists the drafts first.
    const fd = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, follow.id) }))!;
    const nOf = (kind: string) => fd.proposals.findIndex((p) => p.kind === kind) + 1;
    const items = [nOf("content"), nOf("webinar"), nOf("proof")];
    must(items.every((n) => n > 0), `the follow-up proposes the drafts: ${fd.proposals.map((p) => p.kind).join()}`);
    const contentBefore = (await db.query.contentItems.findMany({ where: eq(schema.contentItems.userId, maya.id) })).length;
    const ask = await call("board_apply", { decision: follow.id, items });
    must(!ask.isError && ask.text.startsWith("This will set up:\n1. Draft post: Why DMs beat a cold webinar") && ask.text.includes("Nothing has changed yet"), `voice: read back first: ${ask.text.slice(0, 200)}`);
    must((await db.query.contentItems.findMany({ where: eq(schema.contentItems.userId, maya.id) })).length === contentBefore, "nothing changes without the yes");
    const yes = await call("board_apply", { decision: follow.id, items, confirm: true });
    must(!yes.isError && yes.text.startsWith("Set up 3 of 3."), `voice: set up after the yes: ${yes.text}`);
    const post = (await db.query.contentItems.findMany({ where: eq(schema.contentItems.userId, maya.id) })).find((c) => c.title === "Why DMs beat a cold webinar");
    must(post && post.status === "creating" && post.postAt && post.notes?.includes(`/my-board/${decisionId}`), `a draft post dated on the calendar, never shipped, linked back: ${JSON.stringify(post)}`);
    const web = (await db.query.webinars.findMany({ where: eq(schema.webinars.userId, maya.id) })).find((w) => w.title === "Spring Reset Live");
    must(web && web.status === "draft" && web.scheduledAt && web.notes?.includes(`/my-board/${decisionId}`), `a draft webinar, dated, linked back: ${JSON.stringify(web)}`);
    const proofsNow = (await db.query.proofs.findMany({ where: eq(schema.proofs.userId, maya.id) })).length;
    must((await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.sourceRef, boardRef)) })).some((t) => /^Ask .+ for a testimonial$/.test(t.title)) && proofsNow === proofsBefore, "a testimonial ask as a task, linked back, no proof made");
    const again = await call("board_apply", { decision: follow.id, items, confirm: true });
    must(again.text.startsWith("Those are already set up."), `never twice: ${again.text}`);
    const teamApply = await allTools().find((t) => t.name === "board_apply")!.handler(team, { decision: follow.id, items: [1], confirm: true }).then(() => "ok", (e: Error) => e.message);
    must(teamApply.startsWith("A team member can read the Board's decisions but can't approve"), `a team member can't approve: ${teamApply}`);
    console.log("✓ board_apply: read back and nothing changes, then the yes: a draft post on the calendar, a draft webinar, a testimonial ask; never twice; a team member refused");

    // Slice 3: the check-in line on Today, ticking a step's task, the check-in itself, the scoreboard's count, and sharing.
    const { boardStepsFor } = await import("@/lib/board-steps");
    const top = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, decisionId) }))!;
    const [t1, t2] = top.stepTasks as string[];
    await db.update(schema.tasks).set({ dueDate: addDays(today, -1), status: "today" }).where(eq(schema.tasks.id, t1));
    await page.goto(`${base}/today`);
    const line = await page.locator('[data-testid="today-board-checkin"]').first().innerText();
    must(line.startsWith("Board check-in: 1 step from") && line.includes("is due"), `Today asks for the check-in: ${line}`);
    const m0 = { workspaceId: ws, userId: maya.id };
    const before = await boardStepsFor(m0, addDays(today, -7), addDays(today, 14), today);
    must(before.overdue >= 1, `an open step past its date counts as overdue: ${JSON.stringify(before)}`);
    // Ticking the step's task on Tasks updates the decision.
    await db.update(schema.tasks).set({ status: "done", completedAt: new Date().toISOString() }).where(eq(schema.tasks.id, t2));
    const after2 = await boardStepsFor(m0, addDays(today, -7), addDays(today, 14), today);
    must(after2.done === before.done + 1, `the scoreboard counts the ticked step: ${JSON.stringify(after2)}`);
    await page.goto(`${base}/my-board/${decisionId}`);
    await page.locator('[data-testid="board-checkin"]').waitFor();
    // The check-in reads the latest answer with steps (the Focus follow-up): one done, one stuck.
    const nSteps = await page.locator('[data-testid="board-checkin-step"]').count();
    must(nSteps >= 1, "the check-in lists the steps");
    await page.locator('[data-testid="board-checkin-done-0"]').check();
    for (let i = 1; i < nSteps; i++) await page.locator(`[data-testid="board-checkin-stuck-${i}"]`).check();
    const threadBefore = (await db.query.boardDecisions.findMany({ where: eq(schema.boardDecisions.parentId, decisionId) })).length;
    await page.locator('[data-testid="board-checkin-submit"]').click();
    await page.waitForURL(/\?play=1/, { timeout: 60000 });
    const thread = await db.query.boardDecisions.findMany({ where: eq(schema.boardDecisions.parentId, decisionId), orderBy: desc(schema.boardDecisions.createdAt) });
    must(thread.length === threadBefore + 1 && thread[0].mode === "checkin" && thread[0].question.startsWith("Check-in on this decision.") && (nSteps < 2 || thread[0].answer?.advisors.some((a) => a.seat === "jordan")), `the Board answers the check-in on the same decision, Jordan there for a stuck step: ${thread[0].question.slice(0, 120)}`);
    const sysCheckin = ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] }).system.map((b) => b.text).join("\n");
    must(sysCheckin.includes("Mode: Check-in"), "asked in Check-in mode");
    await page.locator('[data-testid="board-table-recommends"]').waitFor({ timeout: 6 * MAX_TURN_MS + 5000 });
    must((await page.locator('[data-testid="board-checkins"]').innerText()).includes(`1 done, ${nSteps - 1} stuck, 0 dropped`), "the check-in is recorded on the decision");
    console.log("✓ the check-in: Today's line for a step past its date, a ticked task counted on the scoreboard, done and stuck per step, the Board answering in Check-in mode with Jordan");

    // Sharing: private until she shares; then on the coach's Office Hours card; off again.
    await press(page, '[data-testid="board-share"]');
    must((await page.locator('[data-testid="board-shared"]').innerText()).startsWith("Shared with your coach"), "shared");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/office-hours`);
    const card = await page.locator('[data-testid="ooh-shared-decisions"]').innerText();
    must(card.includes(maya.name) && card.includes("Mock decision: where to put this month's hours"), `the coach sees the shared decision: ${card.slice(0, 200)}`);
    must(!card.includes("Should I post daily"), "never a decision she didn't share");
    await logout(page);
    await login(page, "As a client");
    await page.goto(`${base}/my-board/${decisionId}`);
    await press(page, '[data-testid="board-unshare"]');
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/office-hours`);
    must(!(await page.locator('[data-testid="ooh-shared-decisions"]').count()), "stop sharing takes it off the coach's card");
    await logout(page);
    await login(page, "As a client");
    console.log("✓ sharing: private until shared, then on the coach's Office Hours card alone, off again when she stops");

    // Past discussions (H-257): every first question as a row (date, question, recommendation, format, tags), the search.
    // The Board's context (Past decisions among it) rides in the user message, after the member's own words.
    const lastSystem = async () => ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { user: string }).user;
    const askFresh = async (question: string) => {
      await page.goto(`${base}/my-board`);
      await page.locator('[data-testid="board-question"]').fill(question);
      await page.locator('[data-testid="board-submit"]').click();
      await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
      return page.url().split("/my-board/")[1].split(/[?#]/)[0];
    };
    await page.goto(`${base}/my-board`);
    const rows = page.locator('[data-testid="board-discussion"]');
    const tops = (await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.userId, maya.id), isNull(schema.boardDecisions.parentId)), orderBy: desc(schema.boardDecisions.createdAt) }));
    must(tops.length >= 2 && (await rows.count()) === tops.length, `every first question listed: ${await rows.count()} of ${tops.length}`);
    const newest = tops[0];
    const firstRow = await rows.first().innerText();
    must(firstRow.includes(newest.question.slice(0, 30)) && firstRow.includes(newest.answer!.recommendation.slice(0, 30)) && firstRow.includes(MODE_INFO[newest.mode as keyof typeof MODE_INFO].label), `the row: the question, the recommendation and the format: ${firstRow.slice(0, 200)}`);
    must(!(await page.locator('[data-testid="board-discussion-tags"]').count()) && !(await page.locator('[data-testid="board-example"]').count()), "no tags yet; the Example tick is never a client's");
    await page.locator('[data-testid="board-search"]').fill("webinar");
    await page.locator('[data-testid="board-search-go"]').click();
    await page.waitForURL(/q=webinar/);
    must((await rows.count()) === tops.filter((t) => /webinar/i.test(`${t.question} ${t.answer?.decision} ${t.answer?.recommendation}`)).length && (await rows.first().innerText()).toLowerCase().includes("webinar"), "the search keeps the discussions that say webinar");
    await page.goto(`${base}/my-board?q=zzzz-nothing`);
    must((await rows.count()) === 0 && (await page.locator('[data-testid="board-no-discussions"]').innerText()).includes("Nothing matches"), "a search with no match says so");
    await page.locator('[data-testid="board-search-clear"]').click();
    await page.waitForURL(/\/my-board(#|$)/);
    must((await rows.count()) === tops.length, "Clear brings every discussion back");
    console.log("✓ Past discussions: every first question as a row with its date, question, recommendation and format; the search and Clear");

    // "The Board remembers this": off keeps the decision out of the next discussion's prompt and tags the row.
    await page.goto(`${base}/my-board/${decisionId}`);
    must((await page.locator('[data-testid="board-remember-state"]').innerText()).startsWith("The Board remembers this"), "remembered by default");
    await press(page, '[data-testid="board-forget"]');
    must((await page.locator('[data-testid="board-remember-state"]').innerText()).startsWith("Not remembered"), "left out on request");
    await page.goto(`${base}/my-board`);
    // textContent, not innerText: the tags are set in small capitals by CSS.
    must((await page.locator('[data-testid="board-discussion-tags"]').allTextContents()).some((t) => t.includes("Not remembered")), "the row says Not remembered");
    // The mock answers every question with the same decision line, so the memory is checked by its count: the Past decisions
    // heading names how many it read (answered first questions, at most five), and the one left out is one fewer.
    const answeredTops = async () => (await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.userId, maya.id), isNull(schema.boardDecisions.parentId)) })).filter((d) => d.answer).length;
    const pastLine = (text: string) => text.match(/## Past decisions \((\d+)\)/)?.[1] ?? "none";
    const nBeforeForget = await answeredTops();
    must(nBeforeForget >= 2, `two or more answered discussions to remember: ${nBeforeForget}`);
    const afterForget = await askFresh("Should I raise my price next month?");
    let sysMemory = await lastSystem();
    must(pastLine(sysMemory) === String(Math.min(5, nBeforeForget - 1)), `the next discussion reads the others, never the one left out: Past decisions (${pastLine(sysMemory)}) of ${nBeforeForget}`);
    await page.goto(`${base}/my-board/${decisionId}`);
    await press(page, '[data-testid="board-remember-on"]');
    must((await page.locator('[data-testid="board-remember-state"]').innerText()).startsWith("The Board remembers this"), "remembered again");
    console.log("✓ The Board remembers this: on by default, off keeps that decision out of the next prompt (the others still read) and tags the row, on again");

    // Start fresh: the earlier discussions move under "Before your fresh start", the next prompt carries no past decisions; Undo.
    await page.goto(`${base}/my-board`);
    await page.locator('[data-testid="board-start-fresh"] summary').click();
    await press(page, '[data-testid="board-start-fresh-go"]');
    must((await page.locator('[data-testid="board-fresh-done"]').count()) === 1 && (await page.locator('[data-testid="board-before-fresh"]').textContent())!.startsWith("Before your fresh start"), "Start fresh says so and groups the earlier discussions");
    const topsNow = tops.length + 1;
    must((await rows.count()) === topsNow && (await page.locator('[data-testid="board-discussion"][data-before="1"]').count()) === topsNow, "every discussion kept, all before the fresh start");
    must((await db.query.boardDecisions.findMany({ where: eq(schema.boardDecisions.userId, maya.id) })).length >= topsNow, "nothing deleted");
    const afterFresh = await askFresh("Should I hire a VA for my DMs?");
    sysMemory = await lastSystem();
    must(!sysMemory.includes("Past decisions") && !sysMemory.includes(afterForget), "after Start fresh the prompt carries no earlier decision");
    await page.goto(`${base}/my-board`);
    must((await rows.first().getAttribute("data-before")) === "0" && (await rows.first().innerText()).includes("hire a VA") && (await page.locator('[data-testid="board-discussion"][data-before="1"]').count()) === topsNow, "the new discussion sits above the fresh-start group");
    await page.goto(`${base}/my-board/${decisionId}`);
    must((await page.locator('[data-testid="board-decision"]').count()) === 1 && (await page.locator('[data-testid="board-replay"]').count()) === 1, "an earlier discussion still opens, with Play again");
    await page.goto(`${base}/my-board`);
    await press(page, '[data-testid="board-fresh-undo"]');
    must((await page.locator('[data-testid="board-fresh-undone"]').count()) === 1 && !(await page.locator('[data-testid="board-before-fresh"]').count()) && !(await page.locator('[data-testid="board-discussion"][data-before="1"]').count()), "Undo: no group, nothing before");
    const nAfterUndo = await answeredTops();
    await askFresh("Should I keep the Friday calls?");
    sysMemory = await lastSystem();
    must(pastLine(sysMemory) === String(Math.min(5, nAfterUndo)) && nAfterUndo > nBeforeForget, `after Undo every earlier decision is read again: Past decisions (${pastLine(sysMemory)}) of ${nAfterUndo}`);
    void afterFresh;
    console.log("✓ Start fresh: the earlier discussions kept under Before your fresh start, the next prompt empty of them, an earlier one still opening with Play again; Undo brings them back into the prompt");

    // Paging: 20 a page, More adds a page.
    const pageRows = Array.from({ length: 25 }, (_, i) => ({ id: newId(), workspaceId: ws, userId: maya.id, question: `Paging walk question ${i + 1}`, createdAt: `2025-01-${String(1 + (i % 28)).padStart(2, "0")} 09:00:00` }));
    await db.insert(schema.boardDecisions).values(pageRows);
    await page.goto(`${base}/my-board`);
    const allTops = topsNow + 2 + pageRows.length;
    must((await rows.count()) === 20 && (await page.locator('[data-testid="board-more"]').innerText()).includes(`${allTops - 20} more`), `20 a page, More says the rest: ${await page.locator('[data-testid="board-more"]').innerText()}`);
    await page.locator('[data-testid="board-more"]').click();
    await page.waitForURL(/show=40/);
    must((await rows.count()) === allTops && !(await page.locator('[data-testid="board-more"]').count()), `More shows the rest (${allTops}) and then there is no More`);
    await db.delete(schema.boardDecisions).where(inArray(schema.boardDecisions.id, pageRows.map((r) => r.id)));
    console.log("✓ paging: 20 a page, More adds the rest");

    // Example mode: the coach's own tick, saved and replayable, tagged, out of the next prompt and the Forum's count, no tasks.
    const { builtInEvents } = await import("@/lib/forum");
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/my-board`);
    must((await page.locator('[data-testid="board-example"]').count()) === 1, "the Example tick on the coach's own ask box");
    await page.locator('[data-testid="board-question"]').fill("Example for a client: webinar or DMs?");
    await page.locator('[data-testid="board-example"]').check();
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    const exampleId = page.url().split("/my-board/")[1].split(/[?#]/)[0];
    const example = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, exampleId) }))!;
    must(example.example && example.answer && !example.stepTasks.some(Boolean), "saved as an example with its answer, no tasks added");
    must((await page.locator('[data-testid="board-example-tag"]').count()) === 1 && !(await page.locator('[data-testid="board-remember"]').count()), "the decision page tags it Example, no remember switch");
    await page.goto(`${base}/my-board`);
    must((await page.locator('[data-testid="board-discussion-tags"]').first().textContent())!.includes("Example"), "the row tagged Example");
    const coachEvents = await builtInEvents({ workspaceId: ws, userId: coachU.id });
    must(!(coachEvents.board ?? []).some((e) => e.text.includes("Example for a client")), "the Forum never counts an example");
    await page.goto(`${base}/my-board`);
    await page.locator('[data-testid="board-question"]').fill("Should I open a second cohort?");
    await page.locator('[data-testid="board-submit"]').click();
    await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
    sysMemory = await lastSystem();
    const coachPlain = (await db.query.boardDecisions.findMany({ where: and(eq(schema.boardDecisions.userId, coachU.id), isNull(schema.boardDecisions.parentId)) })).filter((d) => d.answer && !d.example).length;
    must(coachPlain >= 1 && pastLine(sysMemory) === String(Math.min(5, coachPlain)), `the coach's next discussion never reads the example: Past decisions (${pastLine(sysMemory)}) of ${coachPlain} plain`);
    const secondId = page.url().split("/my-board/")[1].split(/[?#]/)[0];
    must((await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, secondId) }))!.example === false, "a plain ask is not an example");
    await logout(page);
    await login(page, "As a client");
    console.log("✓ Example mode: the coach's tick only, saved and replayable, tagged Example, no tasks, out of the Forum's count and of the next prompt");

    // Widths and the keyboard: Past discussions at 390, 1024 and 1440 without sideways scroll; Start fresh opens by keyboard.
    for (const w of [390, 1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`${base}/my-board#discussions`);
      const over = await page.locator('section[aria-label="Past discussions"]').evaluate((el) => el.scrollWidth - el.clientWidth);
      must(over <= 0 && (await rows.count()) >= 1, `Past discussions at ${w}: rows shown, no sideways scroll (${over})`);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('[data-testid="board-start-fresh"] summary').focus();
    await page.keyboard.press("Enter");
    must(await page.locator('[data-testid="board-start-fresh-go"]').isVisible(), "Start fresh opens by keyboard, with its confirm");
    await page.setViewportSize({ width: 1280, height: 950 });
    console.log("✓ Past discussions at 390, 1024 and 1440; Start fresh by keyboard");

    // board_checkin by voice, and refused to a team member.
    const latestSteps = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.parentId, decisionId), orderBy: desc(schema.boardDecisions.createdAt) }))!.answer!.steps;
    const said = latestSteps.map((_, i) => ({ n: i + 1, state: i === 0 ? "done" : "dropped" }));
    const ci = await call("board_checkin", { decision: decisionId, steps: said });
    must(!ci.isError && ci.text.includes("The Board recommends: "), `voice: the check-in answered: ${ci.text.slice(0, 160)}`);
    const teamCheck = await allTools().find((t) => t.name === "board_checkin")!.handler(team, { decision: decisionId, steps: said }).then(() => "ok", (e: Error) => e.message);
    must(teamCheck.startsWith("A team member can read the Board's decisions but can't check in"), `a team member can't check in: ${teamCheck}`);
    console.log("✓ board_checkin by voice; a team member refused");

    // Slice 4: the skill for Claude, built from the current principles; the HumanOS switch behind Body's own gate.
    await page.goto(`${base}/settings#board-in-claude`);
    must((await page.locator('[data-testid="board-skill-steps"] li').count()) === 6, "six install steps");
    const skill = await page.request.get(`${base}/api/board/skill`);
    must(skill.status() === 200 && (skill.headers()["content-disposition"] ?? "").includes("evolve-omega-board.skill"), `the skill downloads: ${skill.status()}`);
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await skill.body());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    must(names.length === 3 && names.every((n) => n.startsWith("evolve-omega-board/")) && names.includes("evolve-omega-board/SKILL.md") && names.includes("evolve-omega-board/references/board-profile.md"), `the folder at the archive's root: ${names.join(", ")}`);
    const pack = await zip.file("evolve-omega-board/references/danno-source-pack.md")!.async("string");
    must(pack.includes("Walk the floor") && pack.includes("## Boundaries for Danno"), "the skill carries the coach's current principles");
    console.log("✓ the Board in Claude: six install steps; evolve-omega-board.skill with its folder at the root and the current principles");

    const energy = "I'm tired all the time; should I cut my hours this month?";
    const lastUser = async () => ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { user: string }).user;
    await db.update(schema.memberships).set({ bodyEnabled: true, boardSeesBody: false }).where(eq(schema.memberships.id, m.id));
    await call("board_ask", { decision: energy });
    must(!(await lastUser()).includes("HumanOS"), "the switch off: nothing of HumanOS");
    await page.goto(`${base}/my-board`);
    await page.locator("#hours-edit summary").click();
    await press(page, '[data-testid="board-sees-body-toggle"]');
    must((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.boardSeesBody, "the member's own switch");
    const settings = await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, ws), eq(schema.bodySettings.userId, maya.id)) });
    if (settings) await db.update(schema.bodySettings).set({ aiUse: false }).where(eq(schema.bodySettings.id, settings.id));
    else await db.insert(schema.bodySettings).values({ id: newId(), workspaceId: ws, userId: maya.id, aiUse: false });
    await call("board_ask", { decision: energy });
    must((await lastUser()).includes("HumanOS isn't open to AI in its own settings"), "Body's own AI switch still decides");
    await db.update(schema.bodySettings).set({ aiUse: true }).where(and(eq(schema.bodySettings.workspaceId, ws), eq(schema.bodySettings.userId, maya.id)));
    await call("board_ask", { decision: energy });
    must((await lastUser()).includes("## HumanOS summary"), "both switches on and an energy question: the HumanOS summary");
    await call("board_ask", { decision: "Should I raise the price of my offer?" });
    must(!(await lastUser()).includes("HumanOS"), "a decision that doesn't touch energy, health or time: no HumanOS");
    console.log("✓ HumanOS: nothing with the Board's switch off; with it on, Body's own AI switch still decides; read only for an energy, health or time decision");

    // Choose your council, the library (rev 756): Coach → Board seats, the switch, a council in the room at three widths, the
    // answer sitting with exactly those five, no "I am {Name}", and each answer keeping the version it used.
    {
      const seatId = async (slug: string) => (await db.query.boardSeats.findFirst({ where: and(eq(schema.boardSeats.workspaceId, ws), eq(schema.boardSeats.slug, slug)) }))!.id;
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/coach/board-seats`);
      must((await page.locator('[data-testid="seat-row"]').count()) === 66, "the library: 62 expert seats and the 4 archetypes");
      must((await page.locator('[data-testid="seats-live"]').innerText()).includes("Off"), "Expert seats live is off at launch");
      await page.goto(`${base}/coach/board-seats?area=${encodeURIComponent("Habits & productivity")}`);
      must((await page.locator('[data-testid="seat-row"]').count()) === 5, "filtered by area");
      await page.locator('[data-testid="seat-row"][data-slug="james-clear"] [data-testid="seat-edit"]').click();
      await page.locator('[data-testid="seat-card"]').waitFor();
      await page.locator('[data-testid="seat-card"]').fill("Builds small habits into systems that make the next step automatic.");
      await press(page, '[data-testid="seat-save"]');
      must((await page.locator('[data-testid="seat-row"][data-slug="james-clear"]').getAttribute("data-version")) === "2", "an edit bumps the version");
      // Maya's council, set directly here (as if picked while live; her own picker is walked below): two expert seats, Riley, and an operator expert.
      const council = [await seatId("alex-hormozi"), await seatId("james-clear"), await seatId("riley"), await seatId("seth-godin")];
      await db.update(schema.memberships).set({ boardCouncil: council }).where(eq(schema.memberships.id, m.id));
      await logout(page);
      await login(page, "As a client");
      await page.goto(`${base}/my-board`);
      for (const k of ["alex", "jordan", "riley", "morgan"]) must(await page.locator(`[data-testid="board-plate-${k}"]`).count(), `while expert seats are off, ${k} sits in`);
      must((await page.locator('[data-testid="board-paused"]').innerText()).includes("Paused while expert seats are off"), "the paused chairs are said");
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/coach/board-seats`);
      await press(page, '[data-testid="seats-live-toggle"]');
      must((await page.locator('[data-testid="seats-live"]').innerText()).includes("Live"), "the switch on");
      await logout(page);
      await login(page, "As a client");
      const names: Record<string, string> = { "alex-hormozi": "Alex Hormozi style", "james-clear": "James Clear style", riley: "Riley", "seth-godin": "Seth Godin style" };
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 950 });
        await page.goto(`${base}/my-board`);
        for (const [k, n] of Object.entries(names)) must((await page.locator(`[data-testid="board-plate-${k}"]`).innerText()).includes(n), `${width} wide: the plate shows ${n}`);
        must(!(await page.locator('[data-testid="board-paused"]').count()), `${width} wide: nothing paused once live`);
        must((await page.locator('[data-testid="board-style-note"]').innerText()).includes("not affiliated with or endorsed by them"), `${width} wide: the style-advisor line`);
      }
      await page.setViewportSize({ width: 1280, height: 950 });
      await page.goto(`${base}/my-board`);
      await page.locator('[data-testid="board-question"]').fill("Should I raise my price or add a guarantee first?");
      await page.locator('[data-testid="board-submit"]').click();
      await page.waitForURL(/\/my-board\/[\w-]+\?play=1/, { timeout: 60000 });
      const cid = page.url().split("/my-board/")[1].split(/[?#]/)[0];
      const cd = (await db.query.boardDecisions.findFirst({ where: eq(schema.boardDecisions.id, cid) }))!;
      must(JSON.stringify(cd.seats?.map((s) => s.key)) === JSON.stringify(["danno", "alex-hormozi", "james-clear", "riley", "seth-godin"]), `the answer sat with exactly her five: ${JSON.stringify(cd.seats?.map((s) => s.key))}`);
      must(cd.seats!.find((s) => s.key === "james-clear")!.version === 2 && cd.seats!.find((s) => s.key === "james-clear")!.operator, "the operator's version is recorded");
      must(JSON.stringify(cd.answer?.advisors.map((a) => a.seat)) === JSON.stringify(cd.seats!.map((s) => s.key)), "all five answered");
      must(!cd.answer!.advisors.some((a) => /\bI am (Alex Hormozi|James Clear|Seth Godin)\b/.test(a.text)) && cd.notes.some((n) => n.includes("style advisors never do")), `no "I am {Name}" reaches the member: ${JSON.stringify(cd.notes)}`);
      const sent = ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] }).system.map((b) => b.text).join("\n");
      must(sent.includes("## Alex Hormozi style") && sent.includes("James Clear style is the operator: they own the action steps.") && !sent.includes("No celebrity or real-person seats"), "the profile the AI reads is her council's");
      // An edit after the answer: the past answer still shows the version it used.
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/coach/board-seats?edit=${await seatId("james-clear")}#edit`);
      await page.locator('[data-testid="seat-voice"]').fill("Calm, practical, one small step at a time.");
      await press(page, '[data-testid="seat-save"]');
      must((await page.locator('[data-testid="seat-row"][data-slug="james-clear"]').getAttribute("data-version")) === "3", "a second edit, version 3");
      await logout(page);
      await login(page, "As a client");
      await page.goto(`${base}/my-board/${cid}`);
      const sat = await page.locator('[data-testid="board-sat-with"]').innerText();
      must(sat.includes("James Clear style (version 2)"), `the past answer keeps the version it used: ${sat}`);
      // Back as it was for the other walks.
      await db.update(schema.memberships).set({ boardCouncil: null }).where(eq(schema.memberships.id, m.id));
      await db.update(schema.workspaces).set({ expertSeatsLive: false }).where(eq(schema.workspaces.id, ws));
      console.log("✓ the seat library: 66 seats, an edit bumps the version; paused while off, her council's names at 1440, 1024 and 390 once live; the answer sat with exactly her five, no \"I am {Name}\", and keeps the version it used");
    }

    // Choose your council, the member's page (rev 756 §2 and §3, rev 766): the first-visit prompt and "Keep the classic four";
    // with expert seats off only the archetypes and her own seats; two custom seats (a real person with no sources runs as "my
    // read"); Save held until four seats and an operator; Add, tap to swap, drag to swap; the room's plates at three widths; once
    // live an expert seat's detail and Add into a tapped chair; the switch off again pauses it; the coach sees it all.
    {
      const chairSlugs = async () => Promise.all([0, 1, 2, 3].map(async (i) => (await page.locator(`[data-testid="council-chair-${i}"]`).getAttribute("data-seat")) ?? ""));
      const saveOn = async () => !(await page.locator('[data-testid="council-save"]').isDisabled());
      const problem = async () => ((await page.locator('[data-testid="council-problem"]').count()) ? await page.locator('[data-testid="council-problem"]').innerText() : "");
      await db.delete(schema.boardSeats).where(and(eq(schema.boardSeats.workspaceId, ws), eq(schema.boardSeats.userId, maya.id)));
      await db.update(schema.memberships).set({ boardCouncil: null }).where(eq(schema.memberships.id, m.id));
      await page.setViewportSize({ width: 1280, height: 950 });
      await page.goto(`${base}/my-board`);
      must(await page.locator('[data-testid="board-pick-council"]').count(), "the first visit: \"Pick your council\" above the room");
      await press(page, '[data-testid="board-keep-classic"]');
      must(!(await page.locator('[data-testid="board-pick-council"]').count()) && (await page.locator('[data-testid="board-council-saved"]').innerText()).includes("classic four"), "\"Keep the classic four\" saves and the prompt goes");
      const kept = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.boardCouncil!;
      const slugOfId = async (id: string) => (await db.query.boardSeats.findFirst({ where: eq(schema.boardSeats.id, id) }))!.slug;
      must(JSON.stringify(await Promise.all(kept.map(slugOfId))) === JSON.stringify(["alex", "jordan", "riley", "morgan"]), "the classic four, chair by chair");
      await db.update(schema.memberships).set({ boardCouncil: null }).where(eq(schema.memberships.id, m.id));
      await page.goto(`${base}/my-board`);
      await page.locator('[data-testid="board-pick-council-go"]').click();
      await page.waitForURL(/\/my-board\/council/);
      await page.locator('[data-testid="council-picker"]').waitFor();
      await page.waitForLoadState("networkidle");
      // Expert seats off: the archetypes and her own seats only.
      must(!(await page.locator('[data-testid="council-edge"]').count()), "a client never sees the Edge Preset");
      must(await page.locator('[data-testid="council-experts-off"]').count(), "while expert seats are off, the picker says so");
      must(!(await page.locator('[data-testid="council-tab-area"]').count()) && !(await page.locator('[data-testid="council-tab-all"]').count()), "no skill-area tabs while off");
      must((await page.locator('[data-testid="council-card"]').count()) === 4, "the four archetypes");
      await page.locator('[data-testid="council-search"]').fill("Hormozi");
      must(!(await page.locator('[data-testid="council-card"]').count()), "the switch hides expert seats from members, search too");
      await page.locator('[data-testid="council-search"]').fill("");
      must(JSON.stringify(await chairSlugs()) === JSON.stringify(["alex", "jordan", "riley", "morgan"]) && !(await saveOn()), "her chairs start as the classic four, nothing to save");
      // Two custom seats: a real person with no sources, and one she ticks as turning advice into steps.
      const makeSeat = async (name: string, operator: boolean) => {
        await page.goto(`${base}/my-board/council?tab=custom&make=1#custom-form`);
        await page.locator('[data-testid="council-custom-form"]').waitFor();
        await page.waitForLoadState("networkidle");
        await page.locator('[data-testid="council-custom-name"]').fill(name);
        await page.locator('[data-testid="council-custom-focus"]').fill("Turning a messy idea into a clear first offer people say yes to.");
        for (const i of [0, 1, 2]) await page.locator(`[data-testid="council-custom-q${i}"]`).fill(["Who is it for?", "What will they pay for first?", "What stops them saying yes?"][i]);
        await page.locator('[data-testid="council-custom-voice"]').fill("Warm, quick and practical.");
        if (operator) await page.locator('[data-testid="council-custom-operator"]').check();
        return page.locator('[data-testid="council-custom-real"]').isChecked();
      };
      must(await makeSeat("Marie Forleo", false), "a name that looks like a person pre-ticks \"named after a real person\"");
      await press(page, '[data-testid="council-custom-save"]');
      const marie = page.locator('[data-testid="council-custom-row"]', { hasText: "Marie Forleo style" });
      must((await marie.count()) === 1 && (await marie.locator('[data-testid="council-custom-my-read"]').count()) === 1, "saved as \"Marie Forleo style\", labelled my read with no sources");
      must(!(await makeSeat("The cash-flow hawk", true)), "a name that isn't a person stays unticked");
      await press(page, '[data-testid="council-custom-save"]');
      must((await page.locator('[data-testid="council-custom-row"]').count()) === 2 && !(await page.locator('[data-testid="council-custom-make"]').count()), "two custom seats, the most there can be");
      must((await page.locator('[data-testid="council-card"][data-slug^="custom-"] [data-testid="council-card-my-read"]').count()) === 1, "Marie's card carries the my-read note");
      // The chairs: empty one, Save waits for four; a non-operator seat in Jordan's place, Save waits for an operator.
      await page.locator('[data-testid="council-chair-1-empty"]').click();
      must(!(await saveOn()) && (await problem()) === "Pick four seats for your council.", "three seats: Save is off");
      const cards = page.locator('[data-testid="council-card"]');
      await cards.filter({ hasText: "Marie Forleo style" }).locator('[data-testid="council-card-add"]').click();
      must((await chairSlugs())[1].startsWith("custom-"), "Add fills the empty chair");
      must(!(await saveOn()) && (await problem()) === "Pick at least one operator seat so your Board ends with clear action steps.", "no operator: Save is off and says why");
      // Tap two chairs to swap, then drag one onto another.
      await page.locator('[data-testid="council-chair-0-tap"]').click();
      await page.locator('[data-testid="council-chair-2-tap"]').click();
      must(JSON.stringify((await chairSlugs()).filter((s) => !s.startsWith("custom-"))) === JSON.stringify(["riley", "alex", "morgan"]) && (await chairSlugs())[0] === "riley", `tap two chairs to swap them: ${await chairSlugs()}`);
      await page.locator('[data-testid="council-chair-2"]').dragTo(page.locator('[data-testid="council-chair-3"]'));
      must((await chairSlugs())[2] === "morgan" && (await chairSlugs())[3] === "alex", `drag a chair onto another to swap: ${await chairSlugs()}`);
      // Tap Alex's chair, then Add the hawk: it takes that chair. Four seats with an operator: Save.
      await page.locator('[data-testid="council-chair-3-tap"]').click();
      await cards.filter({ hasText: "The cash-flow hawk" }).locator('[data-testid="council-card-add"]').click();
      must((await chairSlugs())[3].startsWith("custom-") && (await saveOn()) && !(await problem()), "the tapped chair takes the added seat; four with an operator, Save is on");
      await press(page, '[data-testid="council-save"]');
      await page.waitForURL(/\/my-board\?council=saved/);
      const saved = await Promise.all((await db.query.memberships.findFirst({ where: eq(schema.memberships.id, m.id) }))!.boardCouncil!.map(slugOfId));
      must(saved[0] === "riley" && saved[1].startsWith("custom-") && saved[2] === "morgan" && saved[3].startsWith("custom-"), `saved in chair order: ${saved}`);
      for (const width of [1440, 1024, 390]) {
        await page.setViewportSize({ width, height: 950 });
        await page.goto(`${base}/my-board`);
        must((await page.locator(`[data-testid="board-plate-${saved[1]}"]`).innerText()).includes("Marie Forleo style") && (await page.locator(`[data-testid="board-plate-${saved[3]}"]`).innerText()).includes("The cash-flow hawk"), `${width} wide: her plates in the room`);
        await page.goto(`${base}/my-board/council`);
        await page.locator('[data-testid="council-chairs"]').waitFor();
        const fit = JSON.parse(await page.evaluate("JSON.stringify({ doc: document.documentElement.scrollWidth, view: window.innerWidth })")) as { doc: number; view: number };
        must(fit.doc <= fit.view, `${width} wide: the picker fits the screen ${JSON.stringify(fit)}`);
      }
      // Live: the library's expert seats, a detail, and Add into a tapped chair.
      await page.setViewportSize({ width: 1280, height: 950 });
      await db.update(schema.workspaces).set({ expertSeatsLive: true }).where(eq(schema.workspaces.id, ws));
      await page.goto(`${base}/my-board/council`);
      await page.waitForLoadState("networkidle");
      must((await page.locator('[data-testid="council-tab-area"]').count()) === 12 && (await page.locator('[data-testid="council-card"]').count()) === 62, "once live: 12 skill areas and the 62 expert seats, each person once");
      await page.locator('[data-testid="council-tab-area"][data-area="Habits & productivity"]').click();
      must((await page.locator('[data-testid="council-card"]').count()) === 5, "an area tab");
      await page.locator('[data-testid="council-search"]').fill("Graziosi");
      await page.locator('[data-testid="council-card"][data-slug="dean-graziosi"] [data-testid="council-card-open"]').click();
      const dean = await page.locator('[data-testid="council-detail"]').innerText();
      must(dean.includes("Inspired by Dean Graziosi's public work") && !/edge preset/i.test(dean) && (await page.locator('[data-testid="council-detail-sources"] a').count()) > 0, "the detail: inspired-by line, sources as links, never an Edge-preset source");
      await page.locator('[data-testid="council-detail-close"]').click();
      await page.locator('[data-testid="council-chair-0-tap"]').click();
      await page.locator('[data-testid="council-card"][data-slug="dean-graziosi"] [data-testid="council-card-add"]').click();
      must((await chairSlugs())[0] === "dean-graziosi", "Dean takes the tapped chair");
      await press(page, '[data-testid="council-save"]');
      await page.waitForURL(/\/my-board\?council=saved/);
      must((await page.locator('[data-testid="board-plate-dean-graziosi"]').innerText()).includes("Dean Graziosi style") && (await page.locator('[data-testid="board-style-note"]').count()) === 1, "his plate, with the style-advisor line");
      // Off again: the expert pick pauses, and the picker hides experts but shows her paused chair.
      await db.update(schema.workspaces).set({ expertSeatsLive: false }).where(eq(schema.workspaces.id, ws));
      await page.goto(`${base}/my-board/council`);
      must((await page.locator('[data-testid="council-chair-0"]').innerText()).includes("Paused") && (await page.locator('[data-testid="council-card"][data-slug="dean-graziosi"]').count()) === 0, "off again: Dean's chair says paused, and he's out of the library");
      must(!(await page.locator('[data-testid="council-custom-remove"]').count()), "a custom seat on her council can't be removed");
      // The coach sees her council and her custom seats on her client page.
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/coach/${m.id}`);
      const cc = await page.locator('[data-testid="coach-council"]').innerText();
      const cs = await page.locator('[data-testid="coach-custom-seats"]').innerText();
      must(cc.includes("their expert pick is paused") && cc.includes("Marie Forleo style") && cs.includes("Marie Forleo style") && cs.includes("my read only") && cs.includes("The cash-flow hawk"), `the coach sees her council and custom seats: ${cc} | ${cs}`);
      await logout(page);
      await login(page, "As a client");
      // Back as it was for the other walks.
      await db.update(schema.memberships).set({ boardCouncil: null }).where(eq(schema.memberships.id, m.id));
      await db.delete(schema.boardSeats).where(and(eq(schema.boardSeats.workspaceId, ws), eq(schema.boardSeats.userId, maya.id)));
      // The Edge Preset (rev 837): at the top of Choose your council, the coach's own Board only; one tap, then back. An earlier
      // section leaves the coach's Board on the Edge Preset, so it starts from the standard council here.
      const coachUser = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
      await db.update(schema.memberships).set({ boardPreset: "standard" }).where(eq(schema.memberships.userId, coachUser.id));
      await logout(page);
      await login(page, "As the coach");
      await page.goto(`${base}/my-board/council`);
      await press(page, '[data-testid="council-edge-toggle"]');
      must(page.url().includes("/my-board/council") && (await page.locator('[data-testid="council-edge-on"]').count()), "the Edge Preset on, back on the picker");
      await page.goto(`${base}/my-board`);
      for (const [k, n] of [["tony", "Tony Robbins style"], ["dean", "Dean Graziosi style"], ["igor", "Igor Pogany style"], ["jordan", "Jordan"], ["morgan", "Morgan"]]) must((await page.locator(`[data-testid="board-plate-${k}"]`).innerText()).includes(n), `the Edge Preset's plate: ${n}`);
      await page.goto(`${base}/my-board/council`);
      await press(page, '[data-testid="council-edge-toggle"]');
      must(!(await page.locator('[data-testid="council-edge-on"]').count()), "back to the coach's own council");
      await logout(page);
      await login(page, "As a client");
      console.log("✓ Choose your council: the Edge Preset for the coach only, one tap on and off, its five plates; the first-visit prompt and the classic four; experts hidden while off; two custom seats, Marie as my read; Save held for four and an operator; Add, tap and drag to swap; her plates and the picker at 1440, 1024 and 390; live, Dean's detail and chair; off again, paused; the coach sees it");
    }

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nboard walk passed");
  } finally {
    await browser.close();
    try {
      process.kill(-mock.pid!);
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
