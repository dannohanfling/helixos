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
    const { and, desc, eq } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { principlesFromPack, SEATS, MODES, SPEAK_MS } = await import("@/lib/engine/board");
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
    must(took > 4 * SPEAK_MS - 1000 && took < 4 * SPEAK_MS + 3000, `about ${SPEAK_MS} ms a speaker: ${took} ms from the second speaker to the recommendation`);
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

    // Run the discussion again, and tap a seat during it: the playback stops on that advisor; tap again for the whole Board.
    await page.locator('[data-testid="board-replay"]').click();
    await page.locator('[data-testid="board-speaking"]').waitFor({ timeout: 5000 });
    must(!(await page.locator('[data-testid="board-steps"]').count()), "Run the discussion hides the steps until it ends");
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
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = (await (await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${pair.access_token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
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
    await page.locator('[data-testid="board-table-recommends"]').waitFor({ timeout: 40000 });
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
      // Maya's council, set directly here (her own picker is the next commit): two expert seats, Riley, and an operator expert.
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
