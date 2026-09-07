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

    // Join as a brand-new client
    await page.goto(`${base}/join/ACADEMY1`);
    await expectText(page, "Join Evolve Omega Academy", "join page");
    const email = `firstday-${Date.now()}@example.com`;
    await page.fill('input[name="name"]', "Priya Natarajan");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "firstday-pass-123");
    await Promise.all([page.waitForURL(/\/today/, { timeout: 20000 }), page.click('button[type="submit"]')]);

    // Welcome card, not raw operational data
    await expectText(page, "Welcome to HelixOS", "welcome card");
    await expectText(page, "Lock in your first day", "welcome cta");
    const body = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Complete your onboarding form", "Confirm your GoHighLevel access", "Confirm your HelixOS access", "Schedule your kickoff call"]) {
      if (body.includes(admin)) throw new Error(`admin task "${admin}" shown to a new client on Today`);
    }
    if (/\$0 \/ \$5,000/.test(body)) throw new Error("the $0 / $5,000 goal bar is shown on day one");
    await expectText(page, "Set your one goal", "goal prompt instead of bar");
    const exercise = await page.locator('[data-testid="exercise-link"]').first().getAttribute("href");
    if (!exercise) throw new Error("the 30-day build card has no way into the exercise");
    const road = await page.locator('[data-testid="road"]').innerText();
    if (!/Stage 1 of 7 · Week 1 · first conversion event around Week 6/.test(road)) throw new Error(`Today should name the road ahead, got "${road}"`);
    await page.screenshot({ path: "screenshots/fd01-first-today.png", fullPage: true });
    console.log("✓ first Today: welcome card, no admin tasks, no empty goal bar, the road named");

    // Pathway: the next step is a real action, admin tasks are extras
    await page.goto(`${base}/pathway`);
    const now = await page.locator("main").innerText();
    for (const admin of ["Sign the agreement", "Make your first payment", "Confirm your GoHighLevel access"]) {
      if (now.includes(admin) && !/extras?/i.test(now)) throw new Error(`admin task "${admin}" in the simple path`);
    }
    await expectText(page, "Choose where your community will live", "first real step");
    await expectText(page, "first conversion event around Week 6", "pathway header names the destination");
    console.log("✓ pathway: first step is a real action; header names the destination");

    // Courses are reference, not a score; a lesson with nothing behind it is not a checkbox
    await page.goto(`${base}/courses`);
    const coursesText = await page.locator("main").innerText();
    if (/\d+ of \d+ lessons/.test(coursesText)) throw new Error("courses still show a lessons-done score");
    const roadmap = page.locator("li", { hasText: "The Evolve Omega Roadmap" }).first();
    if (await roadmap.count()) {
      if (await roadmap.locator('button:has-text("Done")').count()) throw new Error("the Roadmap lesson is still a bare checkbox");
      if (!(await roadmap.locator('[data-testid="lesson-pending"]').count())) throw new Error("an empty lesson should say the coach is adding it");
    }
    console.log("✓ courses: no score, empty lessons are not checkboxes");

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
      const redo = page.locator('summary:has-text("Redo lock-in")');
      if (await redo.count()) await redo.click();
      await page.fill('input[name="newFocus"]', "Double tap test");
      await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click('button:has-text("Lock it in")')]);
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
    page.once("dialog", (d) => d.dismiss());
    await del.click();
    await page.waitForTimeout(600);
    if ((await page.locator('[data-testid="task-controls"]').count()) !== before) throw new Error("cancelling the confirm still deleted the task");
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), del.click()]);
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
    for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="HelixOS"', "user-scalable=no"]) {
      if (!head.includes(tag)) throw new Error(`head is missing ${tag}`);
    }
    console.log(`✓ installable: manifest, ${m.icons.length} manifest icons, apple-touch-icon, standalone tags`);

    // Small buttons are 40px on a phone
    await page.goto(`${base}/today`);
    const small = page.locator("main .btn-xs, main .btn-sm").first();
    if (await small.count()) {
      const b = await small.boundingBox();
      if (!b || b.height < 38) throw new Error(`small button is ${b?.height}px tall on a phone; needs 40`);
      console.log(`✓ small buttons ${Math.round(b.height)}px on touch`);
    }

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
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("First-day smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
