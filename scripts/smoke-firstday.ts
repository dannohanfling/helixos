/**
 * A brand-new client's first five minutes, on a phone: join with the invite code, land on Today with the welcome card, no
 * contract/payment/access tasks as the next step, no $0 / $5,000 goal bar, no Community Pass upsell in the nav, task controls
 * visible without hover, delete asks first, and inputs at 16px so iOS Safari doesn't zoom.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // The app says when it is still loading a page; wait for that to clear before judging what is on it.
  // Every outline, not one: while React's short reveal queue runs, the outline shown and one inside the content about to be
  // revealed are both in the page, and a single-element wait throws at once on two (read as "still showing").
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-testid="page-loading"]')].every((e) => !e.checkVisibility()), undefined, { timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // Join as a brand-new client: the first screen carries the brand, and the public entrance is set up for sharing but not for search
    await page.goto(`${base}/join/ACADEMY1`);
    await expectText(page, "Join Evolve Omega Academy", "join page");
    const logoSrc = await page.locator('[data-testid="brand-logo"] img').evaluate((el) => (el as HTMLImageElement).currentSrc);
    if (!/evolve-omega-logo-256\.png$/.test(logoSrc)) throw new Error(`auth screen should show the supplied logo at 2×, got ${logoSrc}`);
    if (!(await page.locator("button.btn-brand").count())) throw new Error("the primary auth button is not the brand gold");
    const joinHead = await page.locator("head").innerHTML();
    if (!/name="robots" content="noindex/.test(joinHead)) throw new Error("an invite link is indexable");
    const ogUrl = joinHead.match(/property="og:image" content="([^"]+)"/)?.[1];
    if (!ogUrl) throw new Error("no Open Graph image on the invite page");
    const anonCtx = await browser.newContext();
    const og = await anonCtx.request.get(ogUrl);
    if (og.status() !== 200 || !(og.headers()["content-type"] ?? "").startsWith("image/png")) throw new Error(`OG image ${ogUrl}: ${og.status()} ${og.headers()["content-type"]}`);
    const robots = await anonCtx.request.get(`${base}/robots.txt`);
    if (robots.status() !== 200 || !/Disallow: \//.test(await robots.text())) throw new Error("robots.txt does not keep the app out of search");
    await anonCtx.close();
    console.log("✓ brand on the join screen; invite page noindex with a shareable card; robots.txt disallows the app");
    const email = `firstday-${Date.now()}@example.com`;
    await page.fill('input[name="firstName"]', "Priya");
    await page.fill('input[name="lastName"]', "Natarajan");
    await page.fill('input[name="businessName"]', "Natarajan Wellness");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "firstday-pass-123");
    await page.fill('input[name="confirm"]', "firstday-pass-123");
    await Promise.all([page.waitForURL(/\/today/, { timeout: 20000 }), page.click('button[type="submit"]')]);
    // The first arrival (H-472) plays on a fresh account's first open: Skip, then the button, and the page is theirs.
    if (await page.locator('[data-testid="first-arrival"]').waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await page.locator('[data-testid="arrival-skip"]').click();
      await page.locator('[data-testid="arrival-cta"]').click();
      await page.waitForURL(/\/today/);
    }

    // Welcome card, not raw operational data; nothing behind the login is indexable
    await expectText(page, "Welcome to HelixOS", "welcome card");
    // Next 16 streams metadata to full browsers (crawlers get it in <head> up front), so on a cold compile the tag can land after
    // the page's text: wait for it anywhere in the document rather than reading <head> once.
    if (!(await page.locator('meta[name="robots"][content^="noindex"]').first().waitFor({ state: "attached", timeout: 15000 }).then(() => true, () => false))) throw new Error("an authenticated page is indexable");
    const mark = page.locator('header img[data-testid="app-logo"]').first();
    if (!(await mark.count()) || (await mark.getAttribute("alt")) !== "Evolve Omega" || (await mark.getAttribute("width")) !== "40") throw new Error("the header mark must be the real logo at 40px with real alt text");
    // currentSrc is empty until the browser has picked and loaded a candidate (a cold first page can take a moment): wait for it.
    await mark.evaluate((el) => new Promise<void>((done) => { const img = el as HTMLImageElement; if (img.complete && img.currentSrc) done(); else { img.addEventListener("load", () => done(), { once: true }); setTimeout(done, 10000); } }));
    if (!/app-logo-(light-80\.png|80\.(avif|webp))$/.test(await mark.evaluate((el) => (el as HTMLImageElement).currentSrc))) throw new Error("a 40px logo must be served from the 80px file");
    await expectText(page, "Lock in your first day", "welcome cta");
    // H-164 §1 and §2: the welcome is the only card and holds the lock-in; the picks come ticked; one button.
    if (await page.locator('[data-testid="lockin-hero"]').count()) throw new Error("no second Lock in card while the welcome shows");
    if (!(await page.locator('[data-testid="welcome"] [data-testid="lockin-form"][data-first-day="1"]').count())) throw new Error("the welcome card holds the lock-in itself");
    const preTicked = await page.locator('[data-testid="welcome"] [data-testid="top3-item"] input:checked').count();
    const offered = await page.locator('[data-testid="welcome"] [data-testid="top3-item"]').count();
    if (preTicked !== Math.min(3, offered) || !offered) throw new Error(`the top 3 come ticked (${preTicked} of ${offered} offered)`);
    if ((await page.locator('[data-testid="welcome"] [data-testid="lockin-submit"]').innerText()).indexOf("Lock in your first day") !== 0) throw new Error("one button: Lock in your first day");
    if ((await page.locator("main").innerText()).includes("hashtag")) throw new Error("the hashtag starter is off for new clients (H-164 §3)");
    const body = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Complete your onboarding form", "Confirm your GoHighLevel access", "Confirm your HelixOS access", "Schedule your kickoff call"]) {
      if (body.includes(admin)) throw new Error(`admin task "${admin}" shown to a new client on Today`);
    }
    if (/\$0 \/ \$5,000/.test(body)) throw new Error("the $0 / $5,000 goal bar is shown on day one");
    await expectText(page, "Set your one goal", "goal prompt instead of bar");
    // H-164 §14: Next on your pathway lives on My Helix now, not Today.
    if (await page.locator('[data-testid="pathway-next"]').count()) throw new Error("Next on your pathway moved off Today");
    await page.goto(`${base}/my-helix`);
    const nextStep = page.locator('[data-testid="pathway-next"]');
    if ((await nextStep.innerText()).trim() !== "Write your Big Promise") throw new Error(`a new client's first pathway step should be the Big Promise, got "${await nextStep.innerText()}"`);
    if ((await nextStep.getAttribute("href")) !== "/settings#you") throw new Error("the Big Promise task should open Settings");
    if (!(await page.locator('[data-testid="brand-kit-nudge"]').count())) throw new Error("a new client's My Helix nudges the brand kit");
    await page.goto(`${base}/today`);
    const exercise = await page.locator('[data-testid="exercise-link"]').first().getAttribute("href");
    if (!exercise) throw new Error("the 30-day build card has no way into the exercise");
    if (!(await page.locator('[data-testid="nav-progress"]').count())) throw new Error("no navigation progress bar in the shell");
    await page.locator('[data-testid="exercise-link"]').first().click();
    const armed = await page.locator('[data-testid="nav-progress"]').getAttribute("data-active");
    await page.waitForURL((u) => u.pathname + u.search + u.hash === exercise || u.pathname === exercise.split(/[?#]/)[0], { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    console.log(`✓ "Do it in the app" lands on ${exercise}; progress bar ${armed === "1" ? "showed" : "had already finished"}`);
    await page.goto(`${base}/today`);
    const road = await page.locator('[data-testid="road"]').innerText();
    if (!/Stage 1 of 7 · Week 1 · first conversion event around Week 6/.test(road)) throw new Error(`Today should name the road ahead, got "${road}"`);
    await page.screenshot({ path: "screenshots/fd01-first-today.png", fullPage: true });
    console.log("✓ first Today: welcome card, no admin tasks, no empty goal bar, the road named");

    // H-270 §1, the Setup card: 1 of 20 done at sign-in; the next open steps in needs-first order (S1a, S2, S3; S4 waits for
    // S2); Start Here says coming soon until the coach sets the video; the Example tick of the card never a client's.
    const { db, schema } = await import("@/db");
    const { eq, inArray, and } = await import("drizzle-orm");
    const { newId } = await import("@/lib/ids");
    const { CORE_GROUPS } = await import("@/lib/engine/setup");
    const joined = (await db.query.users.findFirst({ where: eq(schema.users.email, email) }))!;
    const joinedM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, joined.id) }))!;
    const card = page.locator('[data-testid="setup-card"]');
    const nextKeys = async () => page.locator('[data-testid="setup-step"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    const count = async () => (await page.locator('[data-testid="setup-count"]').innerText()).trim();
    if (!(await card.count())) throw new Error("the Setup card is missing from a new client's Today");
    if ((await count()) !== "1 of 20 done") throw new Error(`a fresh client: 1 of 20 done, got "${await count()}"`);
    if ((await nextKeys()).join() !== "s1a,s2,s3") throw new Error(`the next steps follow needs first (S1a, S2, S3), got ${(await nextKeys()).join()}`);
    if (!(await page.locator('[data-testid="welcome"] [data-testid="start-here-soon"]').count())) throw new Error("Start Here says coming soon in the welcome card until the coach sets the video");
    const s2 = page.locator('[data-testid="setup-step"][data-key="s2"]');
    if (!/1 min/.test(await s2.innerText()) || (await s2.locator('[data-testid="setup-step-open"]').getAttribute("href")) !== "/settings#you") throw new Error("S2 shows its minutes and opens Settings → You");
    console.log("✓ Setup card: 1 of 20 done, S1a then S2 and S3, S4 waiting on S2; Start Here coming soon");

    // The three fields complete stage 1 by themselves: promise, audience, goal
    await page.goto(`${base}/settings`);
    await page.fill('textarea[name="bigPromise"]', "I help nutrition coaches fill a group without ads");
    await page.fill('[data-testid="audience-field"]', "Nutrition coaches with a Facebook group");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('form:has([data-testid="audience-field"]) button:has-text("Save")')]);
    await page.waitForLoadState("networkidle");
    await page.goto(`${base}/my-helix`);
    if ((await page.locator('[data-testid="pathway-next"]').innerText()).trim() !== "Set your 90-day revenue goal") throw new Error(`after promise and audience the next step should be the goal, got "${await page.locator('[data-testid="pathway-next"]').innerText()}"`);
    await page.goto(`${base}/settings`);
    await page.fill('#goal input[name="target"]', "5000");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('#goal button[type="submit"]')]);
    await page.waitForLoadState("networkidle");
    await page.goto(`${base}/today`);
    const roadAfter = await page.locator('[data-testid="road"]').innerText();
    if (!/Stage 2 of 7/.test(roadAfter)) throw new Error(`stage 1 should be done once the three fields are set, road says "${roadAfter}"`);
    console.log("✓ stage 1: Big Promise first; promise + audience + goal complete it; the road moves to stage 2");

    // The card ticks itself: Settings → You saved (S2) and the Big Promise with its audience (S5), the goal (S6); S4 now open.
    if ((await count()) !== "4 of 20 done") throw new Error(`after You, the promise and the goal: 4 of 20 done, got "${await count()}"`);
    if (!(await nextKeys()).includes("s4") || (await nextKeys()).includes("s2")) throw new Error(`S4 opens once S2 is saved, S2 leaves the list: ${(await nextKeys()).join()}`);
    console.log("✓ the card ticks itself from Settings and the goal: 4 of 20, S4 open");

    // The coach: the 26 steps as data at 1440, the Start Here video set, a label edited with no deploy.
    const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const coach = await coachCtx.newPage();
    await coach.goto(`${base}/login`);
    await coach.click('button:has-text("As the coach")');
    await coach.waitForURL(/\/today/);
    await coach.goto(`${base}/coach/setup`);
    if ((await coach.locator('[data-testid="coach-setup-step"]').count()) !== 26) throw new Error(`the coach sees all 26 steps, got ${await coach.locator('[data-testid="coach-setup-step"]').count()}`);
    const s3 = coach.locator('[data-testid="coach-setup-step"][data-key="s3"]');
    await s3.locator('[data-testid="setup-label"]').fill("Add your photo (a real one)");
    await Promise.all([coach.waitForResponse((r) => r.request().method() === "POST"), s3.locator('[data-testid="setup-save"]').click()]);
    await s3.locator('[data-testid="setup-saved"]').waitFor({ timeout: 10000 });
    // WebM: the bundled Chromium plays VP9, not H.264, so an mp4 would never reach its metadata here.
    await coach.locator('[data-testid="start-here-url"]').fill("/board/council-night-danno.webm");
    await Promise.all([coach.waitForResponse((r) => r.request().method() === "POST"), coach.locator('[data-testid="start-here-save"]').click()]);
    await coach.locator('[data-testid="start-here-saved"]').waitFor({ timeout: 10000 });
    const sectionOver = await coach.locator('[data-testid="coach-setup"]').evaluate((el) => el.scrollWidth - el.clientWidth);
    if (sectionOver > 0) throw new Error(`Coach → Setup steps scrolls sideways at 1440 (${sectionOver}px)`);
    console.log("✓ coach: 26 steps, a label saved, the Start Here video set, no sideways scroll at 1440");

    // The client sees the edit and the video in the welcome card; played to the end, S1a ticks itself.
    await page.goto(`${base}/today`);
    if ((await page.locator('[data-testid="setup-step"][data-key="s3"] [data-testid="setup-step-label"]').innerText()).trim() !== "Add your photo (a real one)") throw new Error("the coach's edit shows the client with no deploy");
    const video = page.locator('[data-testid="welcome"] [data-testid="start-here-video"]');
    if (!(await video.count())) throw new Error("the Start Here video sits in the welcome card");
    // Evaluated from a string: tsx's keepNames rewrites named inner functions to a helper the page doesn't have.
    const played = (await page.evaluate(`(async () => {
      const v = document.querySelector('[data-testid="welcome"] [data-testid="start-here-video"]');
      if (!v) return "no video";
      const ready = await new Promise((done) => {
        const t = setTimeout(() => done("no metadata after 15 s (readyState " + v.readyState + ", error " + (v.error ? v.error.code : "none") + ")"), 15000);
        if (v.readyState >= 1) { clearTimeout(t); done("ok"); return; }
        v.addEventListener("loadedmetadata", () => { clearTimeout(t); done("ok"); }, { once: true });
        v.addEventListener("error", () => { clearTimeout(t); done("media error " + (v.error ? v.error.code : "?")); }, { once: true });
      });
      if (ready !== "ok") return ready;
      v.muted = true;
      v.currentTime = Math.max(0, v.duration - 0.3);
      try { await v.play(); } catch (e) { return "play refused: " + e.message; }
      return "ok";
    })()`)) as string;
    if (played !== "ok") throw new Error(`the Start Here video can't play in the walk's browser: ${played}`);
    await page.locator('[data-testid="welcome"] [data-testid="start-here-done"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.goto(`${base}/today`);
    if ((await count()) !== "5 of 20 done" || (await nextKeys()).includes("s1a")) throw new Error(`Start Here played to the end ticks S1a: expected 5 of 20 without S1a, got "${await count()}" ${(await nextKeys()).join()}`);
    if (!(await db.query.memberships.findFirst({ where: eq(schema.memberships.id, joinedM.id) }))!.startHereWatchedAt) throw new Error("the watched stamp is on the membership");
    const sidewaysCard = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (sidewaysCard > 0) throw new Error(`the Setup card scrolls sideways at 390 (${sidewaysCard}px)`);
    console.log("✓ the client: the edited label, the video in the welcome card, played to the end ticks S1a (5 of 20), no sideways scroll at 390");

    // The card retires once the first 20 are done; every step stays under Settings → Setup. The undone core steps are made
    // ticks for the fixture (as the coach can on their page), ticked, and their signals put back after.
    const defs = await db.query.setupSteps.findMany();
    const core = defs.filter((d) => (CORE_GROUPS as string[]).includes(d.group));
    const toTick = core.filter((d) => !["signed-in", "profile-saved", "big-promise", "goal", "start-here"].includes(d.signal));
    await db.update(schema.setupSteps).set({ signal: "tick" }).where(inArray(schema.setupSteps.key, toTick.map((d) => d.key)));
    for (const d of toTick) await db.insert(schema.setupTicks).values({ id: newId(), workspaceId: joinedM.workspaceId, userId: joined.id, stepKey: d.key, byUserId: joined.id, byCoach: false }).onConflictDoNothing();
    await page.goto(`${base}/today`);
    if (await card.count()) throw new Error(`the card retires once the first 20 are done (${await count()})`);
    await page.goto(`${base}/settings`);
    const list = page.locator('[data-testid="setup-list"]');
    if (!(await list.count()) || !/20 of 20 done/.test(await list.locator("summary").innerText())) throw new Error("Settings → Setup keeps every step, 20 of 20 done");
    if ((await list.locator('[data-testid="setup-list-step"]').count()) !== 26 || (await list.locator('[data-testid="setup-list-step"][data-key="s21"][data-done="0"]').count()) !== 1) throw new Error("the six When you need them steps stay listed, undone");
    for (const d of toTick) await db.update(schema.setupSteps).set({ signal: d.signal }).where(eq(schema.setupSteps.key, d.key));
    await db.delete(schema.setupTicks).where(and(eq(schema.setupTicks.userId, joined.id), inArray(schema.setupTicks.stepKey, toTick.map((d) => d.key))));
    await coachCtx.close();
    console.log("✓ the card retires at 20 of 20; Settings → Setup keeps all 26 with the six When you need them steps open");

    // Pathway: the next step is a real action, admin tasks are extras
    await page.goto(`${base}/pathway`);
    const now = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Confirm your GoHighLevel access"]) {
      if (now.includes(admin) && !/extras?/i.test(now)) throw new Error(`admin task "${admin}" in the simple path`);
    }
    await page.goto(`${base}/pathway?view=all&stage=onboarding`);
    if (/Choose where your community will live/.test(await page.locator("main").innerText())) throw new Error("the community-platform task is still in stage 1");
    await page.goto(`${base}/pathway?view=all&stage=system-install`);
    await expectText(page, "Choose where your community will live", "platform choice lives in system-install");
    await page.goto(`${base}/pathway`);
    await expectText(page, "first conversion event around Week 6", "pathway header names the destination");
    console.log("✓ pathway: first step is a real action; header names the destination");

    // Courses are reference, not a score; a lesson with nothing behind it is not a checkbox
    await page.goto(`${base}/courses`);
    const coursesText = await page.locator("main").innerText();
    if (/\d+ of \d+ lessons/.test(coursesText)) throw new Error("courses still show a lessons-done score");
    // A client never sees an empty lesson (friction walk P1): no "Your coach is adding this lesson", and a program with nothing
    // filled points to the Pathway instead.
    if (await page.locator('[data-testid="lesson-pending"]').count()) throw new Error("a client sees no empty lesson");
    if (!(await page.locator('[data-testid="courses-pathway"]').count()) && !(await page.locator('[data-testid="lesson-open"], button:has-text("Done")').count())) throw new Error("a client sees filled lessons, or the Pathway pointer");
    console.log("✓ courses: no score, no empty lessons for a client, the Pathway pointer when nothing is filled");

    // The whole tier ladder, locks on, exact gap to the next rung
    await page.goto(`${base}/rewards`);
    const rungs = page.locator('[data-testid="tier-ladder"] li');
    if ((await rungs.count()) !== 9) throw new Error(`expected 9 tiers, saw ${await rungs.count()}`);
    const ladderText = await page.locator('[data-testid="tier-ladder"]').innerText();
    if (!/you are here/.test(ladderText) || !/more to unlock/.test(ladderText) || !/Olympian[\s\S]*locked/.test(ladderText)) throw new Error(`ladder should show current, next gap and locked rungs:\n${ladderText}`);
    console.log("✓ rewards: nine tiers, current, gap to next, locked rungs visible");

    // No Community Pass upsell in the nav for a non-Elite client (mobile "More" and the desktop sidebar markup)
    await page.goto(`${base}/more`);
    const more = await page.locator("main").innerText();
    if (/Community Pass/.test(more)) throw new Error("Community Pass shown in More for a non-Elite client");
    const side = await page.locator("aside, nav").allInnerTexts();
    if (!side.length || !side.join(" ").includes("Today")) throw new Error("the navigation is on the page to read");
    if (side.join(" ").includes("Community Pass")) throw new Error("Community Pass shown in the sidebar for a non-Elite client");
    console.log("✓ nav: no Community Pass upsell without the pass");

    // Double-tapping Add task makes one task; a redone lock-in with the same typed task makes none
    await page.goto(`${base}/tasks`);
    await page.click('summary:has-text("+ New task")');
    await page.fill('input[name="title"]', "Double tap test");
    const add = page.locator('button:has-text("Add task")');
    await add.click();
    await add.click({ force: true }).catch(() => null);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    if ((await page.locator('[data-testid="task-row"]', { hasText: "Double tap test" }).count()) !== 1) throw new Error("a double-tapped Add task created more than one task");
    // Lock in typing the same task (it exists: star it, don't clone it), then redo the lock-in with it typed again
    for (const pass of ["first lock-in", "redone lock-in"]) {
      await page.goto(`${base}/today`);
      const redo = page.locator('summary:has-text("Edit lock-in")');
      if (await redo.count()) await redo.evaluate((el) => (el as HTMLElement).click()); // may sit under the fixed bottom nav on a phone
      await page.fill('[data-testid="top3-new"]', "Double tap test");
      await page.click('[data-testid="top3-add"]');
      await page.locator('[data-testid="top3-item"]', { hasText: "Double tap test" }).waitFor({ timeout: 15000 });
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('[data-testid="lockin-submit"]')]);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(800);
      const dupes = await page.locator('[data-testid="task-row"]', { hasText: "Double tap test" }).count();
      if (dupes !== 1) throw new Error(`the ${pass} duplicated the task (${dupes} rows on Today)`);
    }
    console.log("✓ no duplicate from a double tap or a redone lock-in; a starred task shows once");

    // The tick answers on the tap and says it is working
    const toggle = page.locator('[data-testid="task-row"]', { hasText: "Double tap test" }).locator('[data-testid="task-toggle"]');
    await toggle.click();
    const busyOrDone = await toggle.evaluate((el) => el.getAttribute("aria-busy") === "true" || el.textContent?.includes("✓"));
    if (!busyOrDone) throw new Error("the tick gave no immediate response");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    console.log("✓ tick responds at once (busy or done) before the server answers");

    // Task controls visible without hover, 40px targets, words on touch, delete asks first
    await page.goto(`${base}/tasks`);
    const controls = page.locator('[data-testid="task-controls"]').first();
    await controls.waitFor();
    const labels = await controls.locator(".task-control-label").allInnerTexts();
    if (!(labels.includes("Top 3") || labels.includes("Unstar")) || !labels.includes("Tomorrow") || !labels.includes("Delete")) throw new Error(`controls should say what they do on a phone: ${labels.join(", ")}`);
    const labelVisible = await controls.locator(".task-control-label").first().isVisible();
    if (!labelVisible) throw new Error("control words are hidden on a phone");
    const opacity = await controls.evaluate((el) => Number(getComputedStyle(el).opacity));
    if (opacity < 0.5) throw new Error(`task controls hidden without hover (opacity ${opacity})`);
    const del = controls.locator('button[title="Delete"]');
    const box = await del.boundingBox();
    if (!box || box.height < 38 || box.width < 38) throw new Error(`delete target too small on touch: ${JSON.stringify(box)}`);
    const before = await page.locator('[data-testid="task-controls"]').count();
    // The app's own confirm: Cancel is focused, so Enter cancels; nothing is sent.
    await del.click();
    await page.locator("dialog[open]").waitFor({ timeout: 5000 });
    if ((await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid)) !== "confirm-delete-cancel") throw new Error("Cancel is the default in the delete confirm");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    if ((await page.locator("dialog[open]").count()) || (await page.locator('[data-testid="task-controls"]').count()) !== before) throw new Error("cancelling the confirm still deleted the task");
    await del.click();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('dialog[open] [data-testid="confirm-delete-yes"]').click()]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const after = await page.locator('[data-testid="task-controls"]').count();
    if (after >= before) throw new Error(`confirming did not delete the task (${before} → ${after})`);
    console.log("✓ task controls visible on touch, 40px targets, delete confirms first");

    // Installable: manifest and icons load without a session, the page links them, iOS gets its full-screen tags
    const anon = await browser.newContext();
    const manifest = await anon.request.get(`${base}/manifest.webmanifest`);
    if (manifest.status() !== 200) throw new Error(`manifest returned ${manifest.status()} without a session`);
    const m = (await manifest.json()) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };
    if (m.name !== "HelixOS" || m.start_url !== "/today" || m.display !== "standalone" || !m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")) throw new Error(`manifest wrong: ${JSON.stringify(m)}`);
    for (const icon of m.icons) {
      const r = await anon.request.get(`${base}${icon.src}`);
      if (r.status() !== 200 || !(r.headers()["content-type"] ?? "").startsWith("image/png")) throw new Error(`icon ${icon.src}: ${r.status()} ${r.headers()["content-type"]}`);
    }
    for (const p of ["/apple-icon", "/icon"]) {
      const r = await anon.request.get(`${base}${p}`);
      if (r.status() !== 200 || !(r.headers()["content-type"] ?? "").startsWith("image/png")) throw new Error(`${p}: ${r.status()} ${r.headers()["content-type"]}`);
    }
    await anon.close();
    const head = await page.locator("head").innerHTML();
    if (/user-scalable=no|maximum-scale=1\b/.test(head)) throw new Error("pinch zoom is disabled; low-vision members need it");
    for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="HelixOS"']) {
      if (!head.includes(tag)) throw new Error(`head is missing ${tag}`);
    }
    console.log(`✓ installable: manifest, ${m.icons.length} manifest icons, apple-touch-icon, standalone tags; pinch zoom on`);

    // Under pinch zoom the bars hold still: pinned to the visual viewport, counter-scaled
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await page.waitForTimeout(400);
    const pinned = await page.evaluate(() => ({
      scale: window.visualViewport?.scale,
      header: document.querySelector('[data-pin="top"] > *')?.getAttribute("style") ?? "",
      nav: document.querySelector('[data-pin="bottom"] > *')?.getAttribute("style") ?? "",
    }));
    if (pinned.scale && pinned.scale > 1.5) {
      if (!/scale\(0\.5\)/.test(pinned.header) || !/position: fixed/.test(pinned.header)) throw new Error(`header not pinned under zoom: ${pinned.header}`);
      if (!/scale\(0\.5\)/.test(pinned.nav)) throw new Error(`bottom nav not pinned under zoom: ${pinned.nav}`);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await page.waitForTimeout(300);
      const restored = await page.evaluate(() => document.querySelector('[data-pin="top"] > *')?.getAttribute("style") ?? "");
      if (/scale\(/.test(restored)) throw new Error("header still transformed after zoom returned to 1");
      console.log("✓ bars pinned to the visual viewport under 2× zoom, released at 1×");
    } else console.log(`· page scale emulation unavailable here (scale ${pinned.scale}); pin not exercised`);

    // Small buttons are 40px on a phone. Unconditional: lock a task into Today first, so its controls are always there to measure.
    await page.goto(`${base}/today`);
    const redoForTouch = page.locator('summary:has-text("Edit lock-in")');
    if (await redoForTouch.count()) await redoForTouch.evaluate((el) => (el as HTMLElement).click());
    await page.fill('[data-testid="top3-new"]', "Touch target test");
    await page.press('[data-testid="top3-new"]', "Enter");
    await page.locator('[data-testid="top3-item"]', { hasText: "Touch target test" }).waitFor({ timeout: 15000 });
    // Tick it even when three are already ticked: untick the others first.
    const touchPicker = page.locator('[data-testid="top3-picker"]');
    if (!(await touchPicker.locator('[data-testid="top3-item"]', { hasText: "Touch target test" }).locator("input").isChecked())) {
      while (await touchPicker.locator('input[name="focus"]:checked').count()) await touchPicker.locator('input[name="focus"]:checked').first().uncheck();
      await touchPicker.locator('[data-testid="top3-item"]', { hasText: "Touch target test" }).locator("input").check();
    }
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('[data-testid="lockin-submit"]')]);
    await page.waitForLoadState("networkidle");
    const small = page.locator('[data-testid="task-row"]', { hasText: "Touch target test" }).locator(".btn-xs, .btn-sm").first();
    await small.waitFor({ timeout: 5000 });
    const b = await small.boundingBox();
    if (!b || b.height < 38) throw new Error(`small button is ${b?.height}px tall on a phone; needs 40`);
    console.log(`✓ small buttons ${Math.round(b.height)}px on touch`);

    // Developer copy never reaches a client
    for (const p of ["/doctrine", "/courses"]) {
      await page.goto(`${base}${p}`);
      const t = await page.locator("main").innerText();
      if (/run the seed|npm |\.env|_KEY\b/i.test(t)) throw new Error(`developer copy on ${p}`);
    }
    console.log("✓ no developer copy on doctrine or courses");

    // Inputs at 16px
    await page.goto(`${base}/tasks`);
    const fs = await page.locator("input.field, textarea.field, select.field").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fs < 16) throw new Error(`.field renders at ${fs}px; iOS Safari zooms below 16`);
    console.log(`✓ fields at ${fs}px`);
  } finally {
    await browser.close();
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("First-day smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
