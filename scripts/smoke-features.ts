/**
 * Bot Features (rev 618): the eight cards in Danno's order and copy, each state read against the server's own reading of the
 * member (never typed from memory); an auto unlock (a Proof Bank entry); the coach's milestone ticks; setup checked and kept on
 * a refusal, then "Turn it on for me" and the coach's queue with the setup; Switched on, which turns the card On, puts a line on
 * the client's Today and emails them; a rule changed on the rules page (and a bad one refused); the phone list at 375px with
 * 44px targets and the lock's label. Runs against the dev server; with no SendGrid key the email is logged in its log.
 */
import { readFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
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
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
const devLog = () => {
  try {
    return readFileSync("screenshots/logs/dev.log", "utf8");
  } catch {
    return "";
  }
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { featuresFor } = await import("@/lib/bot-features");
  const { BOT_FEATURES } = await import("@/lib/engine/bot-features");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const member = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = (await member()).workspaceId;
  // A clean start for the two milestones this walk ticks: no proof (so the auto unlock is seen happen), no ticks.
  await db.delete(schema.proofs).where(and(eq(schema.proofs.workspaceId, ws), eq(schema.proofs.userId, maya.id)));
  await db.update(schema.memberships).set({ botUnlocks: [] }).where(eq(schema.memberships.userId, maya.id));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    /** Every card's state on the page, against the server's reading of Maya: the same eight, in Danno's order. */
    const statesMatch = async (label: string) => {
      await page.goto(`${base}/bot-features`);
      const cards = page.locator('[data-testid="bf-card"]');
      must((await cards.count()) === BOT_FEATURES.length, `${label}: ${BOT_FEATURES.length} cards`);
      const shown = await cards.evaluateAll((els) => els.map((e) => [e.getAttribute("data-key"), e.getAttribute("data-state")]));
      const expected = (await featuresFor(await member())).map((x) => [x.feature.key, x.state]);
      must(JSON.stringify(shown) === JSON.stringify(expected), `${label}: the cards should read ${JSON.stringify(expected)}, got ${JSON.stringify(shown)}`);
      const open = expected.filter(([, s]) => s === "unlocked" || s === "requested" || s === "on").length;
      must((await page.locator('[data-testid="bf-count"]').innerText()).trim() === `${open} of ${BOT_FEATURES.length} unlocked`, `${label}: the count says ${open} of ${BOT_FEATURES.length}`);
      return Object.fromEntries(expected) as Record<string, string>;
    };

    // The page: eight cards, Danno's copy, a free feature unlocked, Coming soon dashed, a locked card's line
    await login(page, "As a client");
    let states = await statesMatch("first look");
    must(states.no_show_rescue === "unlocked" && states.ladder_dripper === "coming_soon" && states.win_back_nudge === "locked" && states.referral_engine === "locked", `the starting states: ${JSON.stringify(states)}`);
    for (const f of BOT_FEATURES) must(await page.locator(`[data-testid="bf-card"][data-key="${f.key}"]`).getByText(f.description, { exact: true }).count(), `${f.name}'s card carries Danno's description`);
    must((await page.locator('[data-testid="bf-card"][data-key="win_back_nudge"]').innerText()).includes("Unlocks when you have 25 contacts in your bot"), "a locked card says what unlocks it");
    must(await page.locator('[data-testid="bf-card"][data-key="no_show_rescue"] [data-testid="bf-setup"]').count(), "an unlocked card offers Set it up");
    console.log("✓ eight cards in Danno's order and words, states as the server reads them, the count and the locked line");

    // An auto unlock: a first Proof Bank entry unlocks the Referral Engine (rev 618: any entry counts)
    await db.insert(schema.proofs).values({ id: crypto.randomUUID(), workspaceId: ws, userId: maya.id, name: "Walk proof", status: "draft" });
    states = await statesMatch("after a proof");
    must(states.referral_engine === "unlocked", "a Proof Bank entry unlocks the Referral Engine");
    console.log("✓ auto unlock: a first Proof Bank entry, draft or not, unlocks the Referral Engine");

    // The coach ticks two milestones HelixOS can't see; both cards unlock
    await logout(page);
    await login(page, "As the coach");
    const m = await member();
    await page.goto(`${base}/coach/${m.id}#bot-unlocks`);
    await page.waitForLoadState("networkidle");
    await page.check('[data-testid="bot-unlock-contacts_25"]');
    await page.check('[data-testid="bot-unlock-event_scheduled"]');
    await submit(page, '[data-testid="bot-unlocks-save"]');
    must(JSON.stringify((await member()).botUnlocks.sort()) === JSON.stringify(["contacts_25", "event_scheduled"]), "the ticks are saved on the client");
    await logout(page);
    await login(page, "As a client");
    states = await statesMatch("after the ticks");
    must(states.win_back_nudge === "unlocked" && states.seat_filler === "unlocked", "the coach's ticks unlock Win-Back Nudge and Seat Filler");
    console.log("✓ coach ticks: 25 contacts and an event unlock their features");

    // Seat Filler: a bad link is refused with the entries kept; then Turn it on for me
    await page.click('[data-testid="bf-card"][data-key="seat_filler"] [data-testid="bf-setup"]');
    await page.waitForURL(/\/bot-features\/seat_filler/);
    await page.waitForLoadState("networkidle");
    must((await page.locator('[data-testid="bf-ghl"]').innerText()).includes("EO Event Registered"), "the GoHighLevel box names the tag");
    must((await page.locator(".bf-steps li").count()) === 3, "three steps under How it works");
    await page.fill("#bf-eventName", "Walk Workshop");
    await page.fill("#bf-eventWhen", "Thursday 16 Oct, 7pm Pacific");
    // The browser's own check would stop this first; the server's is the boundary, so it is the one tested.
    await page.locator('[data-testid="bf-form"]').evaluate((el: HTMLFormElement) => (el.noValidate = true));
    await page.fill("#bf-eventUrl", "zoom dot us");
    await submit(page, '[data-testid="bf-turn-on"]');
    must((await page.locator('[data-testid="bf-error"]').innerText()).includes("needs a full link"), "a link that isn't one is refused, by name");
    must((await page.inputValue("#bf-eventName")) === "Walk Workshop" && (await page.getAttribute("#bf-eventUrl", "aria-invalid")) === "true", "the entries stay and the bad field is marked");
    await page.fill("#bf-eventUrl", "https://zoom.us/j/123");
    await submit(page, '[data-testid="bf-turn-on"]');
    await page.locator('[data-testid="bf-requested"]').waitFor();
    const req = await db.query.botFeatureRequests.findFirst({ where: and(eq(schema.botFeatureRequests.userId, maya.id), eq(schema.botFeatureRequests.featureKey, "seat_filler")) });
    must(req?.state === "requested" && req.setup.eventUrl === "https://zoom.us/j/123" && req.setup.eventName === "Walk Workshop", `the request keeps the setup: ${JSON.stringify(req)}`);
    states = await statesMatch("after the request");
    must(states.seat_filler === "requested" && (await page.locator('[data-testid="bf-card"][data-key="seat_filler"]').innerText()).includes("Requested · we'll let you know when it's live"), "the card says Requested");
    console.log("✓ setup: a bad link refused with entries kept; Turn it on for me files the request with the setup; the card says Requested");

    // The coach's queue: the request with its setup, counted on Today; Switched on turns it On and emails the client
    await logout(page);
    await login(page, "As the coach");
    must((await page.locator('[data-testid="coach-new-features"]').innerText()).includes("1 bot feature to switch on"), "the coach's Today counts the request");
    await page.goto(`${base}/coach#bot-features`);
    const row = page.locator('[data-testid="feature-request"][data-key="seat_filler"]');
    must((await row.count()) === 1 && (await row.innerText()).includes("Maya") && (await row.locator('[data-testid="feature-setup"]').innerText()).includes("https://zoom.us/j/123"), "the queue shows who, which feature and the setup");
    const logBefore = devLog().length;
    await submit(page, '[data-testid="feature-request"][data-key="seat_filler"] [data-testid="feature-switch-on"]');
    must((await db.query.botFeatureRequests.findFirst({ where: eq(schema.botFeatureRequests.id, req!.id) }))?.state === "on", "Switched on records it on");
    await page.waitForTimeout(500);
    must(devLog().slice(logBefore).includes('subject="Seat Filler is on in your bot"'), "the client is emailed that it's on");
    must((await page.locator('[data-testid="feature-request"][data-key="seat_filler"] [data-testid="feature-not-on"]').count()) === 1, "an On request can be put back");
    console.log("✓ coach: the request with its setup, counted on Today; Switched on records it and emails the client");

    // The client: On on the card and the page, and a line on Today
    await logout(page);
    await login(page, "As a client");
    must((await page.locator('[data-testid="feature-on-line"]').innerText()).includes("Seat Filler is on"), "the client's Today says it's on");
    states = await statesMatch("after On");
    must(states.seat_filler === "on" && (await page.locator('[data-testid="bf-card"][data-key="seat_filler"]').innerText()).includes("Running in your bot"), "the card says On, Running in your bot");
    console.log("✓ client: On on the card, a line on Today");

    // The phone: a list, 44px targets, the lock labelled
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${base}/bot-features`);
    must(!(await page.locator('[data-testid="bf-grid"]').isVisible()) && (await page.locator('[data-testid="bf-list"]').isVisible()), "the grid becomes a list on a phone");
    must((await page.locator('[data-testid="bf-row"]').count()) === BOT_FEATURES.length, "eight rows");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    must(wide <= 375, `no sideways scroll on a phone (${wide}px)`);
    const buttons = page.locator('[data-testid="bf-row-setup"]');
    must((await buttons.count()) > 0, "an unlocked row has Set it up");
    for (const b of await buttons.all()) must(((await b.boundingBox())?.height ?? 0) >= 44, "Set it up is at least 44px tall");
    const locked = page.locator('[data-testid="bf-row"][data-state="locked"]');
    must((await locked.count()) > 0 && (await locked.first().locator('svg[aria-label="Locked"]').count()) === 1, "a locked row's lock is labelled Locked");
    must((await page.locator('[data-testid="bf-row"][data-key="win_back_nudge"]').innerText()).includes("Checks in with people who went quiet."), "an unlocked row carries its short line");
    await page.screenshot({ path: "screenshots/bf-phone.png", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    console.log("✓ phone: a list of eight, no sideways scroll, 44px Set it up, the lock labelled, the short lines");

    // A rule changed: Regulars Club at 1 point unlocks it; a points rule that isn't a number is refused
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/bot-features`);
    await page.waitForLoadState("networkidle");
    await page.selectOption('[data-testid="rule-type-regulars_club"]', "points");
    await page.fill('[data-testid="rule-points-regulars_club"]', "1");
    await page.selectOption('[data-testid="rule-type-win_back_nudge"]', "points");
    await page.fill('[data-testid="rule-points-win_back_nudge"]', "lots");
    await Promise.all([page.waitForURL(/\/coach\/bot-features\?/), page.click('[data-testid="rules-save"]')]);
    must((await page.locator('[data-testid="rules-bad"]').innerText()).includes("Win-Back Nudge"), "a bad rule is named and left as it was");
    const rows = await db.query.botFeatureRules.findMany({ where: eq(schema.botFeatureRules.workspaceId, ws) });
    must(rows.find((r) => r.featureKey === "regulars_club")?.value === "1" && !rows.find((r) => r.featureKey === "win_back_nudge" && r.type === "points"), `the good rule is saved, the bad one isn't: ${JSON.stringify(rows.map((r) => [r.featureKey, r.type, r.value]))}`);
    await logout(page);
    await login(page, "As a client");
    states = await statesMatch("after the rule");
    must(states.regulars_club !== "locked", "Regulars Club at one point is unlocked");
    console.log("✓ rules: Regulars Club by points unlocks it; a rule that isn't a number is refused by name");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nfeatures walk passed");
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
