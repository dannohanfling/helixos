/**
 * Fathom harvest, phase 1: the client's own key with tick one, the recording list, one recording read only when the client
 * picks it, quotes kept only when word for word, tick two before approval, trims never rewrites, attribution on every
 * copy, approved proof reaching the webinar wizard and the composer. Runs against scripts/mock-fathom.ts and scripts/mock-ai.ts;
 * the dev server must be started with FATHOM_BASE_URL=http://localhost:4030 and AI_BASE_URL=http://localhost:4020.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const fathomPort = 4030;
const aiPort = 4020;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
const reads = async () => ((await (await fetch(`http://localhost:${fathomPort}/__reads`)).json()) as { reads: string[] }).reads;

const QUOTE = "I've had three new clients this month and I didn't chase a single one.";
const TICK_ONE = "These are my clients' recordings. Anything I take from them is someone else's words, and it's my responsibility to have their permission before I use it anywhere.";
const TICK_TWO = "Jess Morgan-Lee has given me permission to use what they said here in my marketing.";

async function main() {
  const fathom = spawn("npx", ["tsx", "scripts/mock-fathom.ts", String(fathomPort)], { stdio: "ignore", detached: true });
  const ai = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // Absent key: the feature is visible and says what is missing
    await page.goto(`${base}/proof`);
    await expectText(page, "Harvest from Fathom", "harvest card");
    if (!(await page.locator('[data-testid="harvest-needs-key"] a[href="/settings#fathom"]').count())) throw new Error("the harvest card must point at Settings when there is no key");
    await page.goto(`${base}/proof/harvest`);
    if (!(await page.locator('[data-testid="harvest-needs-key"]').count())) throw new Error("the harvest page must say the key is missing");
    console.log("✓ without a key the feature is visible and points at Settings");

    // Connecting: tick one is required, the wording exact, a bad key says why, a good key connects
    await page.goto(`${base}/settings`);
    const tickOne = (await page.locator('[data-testid="fathom-consent"]').innerText()).replace(/\s+/g, " ").trim();
    if (tickOne !== TICK_ONE) throw new Error(`tick one wording differs:\n${tickOne}`);
    await fillExact(page, '[data-testid="fathom-key"]', "fathom-good");
    await submit(page, '[data-testid="fathom-connect"]');
    await expectText(page, "Tick the line about your clients", "consent required");
    await page.check('[data-testid="fathom-consent"] input');
    await fillExact(page, '[data-testid="fathom-key"]', "fathom-bad");
    await submit(page, '[data-testid="fathom-connect"]');
    await expectText(page, "rejected the key (401)", "bad key reason");
    if (!(await page.locator('[data-testid="fathom-consent-date"]').count())) throw new Error("tick one should be dated once ticked, even with a bad key");
    await fillExact(page, '[data-testid="fathom-key"]', "fathom-good");
    await submit(page, '[data-testid="fathom-connect"]');
    await expectText(page, "connected · ····good", "connected");
    await page.screenshot({ path: "screenshots/f01-settings-fathom.png", fullPage: true });
    console.log("✓ tick one required and dated; bad key explained; good key connected");

    // The list shows titles only; nothing is read until the client picks one
    await page.goto(`${base}/proof/harvest`);
    await expectText(page, "Jess and Evolve Omega", "recording listed");
    await expectText(page, "Evolve Omega: Business Strategy", "recording listed 2");
    if ((await reads()).length) throw new Error(`the list must not read any transcript, read: ${(await reads()).join(",")}`);
    if (!(await page.locator('[data-testid="harvest-needs-ai"]').count())) throw new Error("without an AI key the page must say so");
    if (!(await page.locator('[data-testid="read-recording"]').first().isDisabled())) throw new Error("reading must wait for an AI key");
    // Connect the AI key
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
    await expectText(page, "connected · Anthropic", "ai connected");

    await page.goto(`${base}/proof/harvest`);
    await submit(page, '[data-testid="recording"][data-recording-id="180896622"] [data-testid="read-recording"]');
    await page.waitForURL(/recording=180896622/);
    const read = await reads();
    if (read.join(",") !== "180896622") throw new Error(`exactly the picked recording must be read, once; read: ${read.join(",")}`);
    await expectText(page, "1 new quote saved as drafts", "one verbatim quote kept");
    await expectText(page, "1 dropped because it was not word for word", "the invented one dropped");
    await page.screenshot({ path: "screenshots/f02-harvest.png", fullPage: true });
    console.log("✓ only the picked recording was read; the verbatim quote kept, the invented one dropped");

    // The draft: verbatim, attributed by the transcript, linked to the moment, with context; invisible while a draft
    await page.click('[data-testid="harvest-drafts"] a');
    await page.waitForURL(/\/proof\/[a-z0-9-]+$/i);
    const quote = (await page.locator('[data-testid="verbatim-quote"]').innerText()).replace(/[“”]/g, "").trim();
    if (quote !== QUOTE) throw new Error(`quote is not verbatim: ${quote}`);
    await expectText(page, "Jess Morgan", "speaker named from the invitees, the label was an email");
    if (!(await page.locator('[data-testid="speaker-label"]').count())) throw new Error("the transcript's own label must be shown beside the corrected name");
    const link = await page.locator('[data-testid="quote-link"]').getAttribute("href");
    if (link !== "https://fathom.video/calls/815301715?timestamp=739") throw new Error(`link must be the meeting url with the second, never the recording id, got ${link}`);
    if (!(await page.locator('[data-testid="quote-context"]').count())) throw new Error("context missing");
    if (await page.locator('button:has-text("Draft a win post")').count()) throw new Error("a draft quote must not be offered to a post");
    const proofUrl = page.url();
    await page.goto(`${base}/content/compose`);
    if (await page.locator('select[aria-label="Pick a proof from the bank"] option:has-text("Jess M.")').count()) throw new Error("a draft must not reach the composer");
    console.log("✓ draft: verbatim, speaker and time from the transcript, context shown, invisible to pickers");

    // A rewrite of the quote is refused; a trim with an ellipsis is saved; the hook is the client's own framing; the name can be corrected while a draft
    await page.goto(proofUrl);
    if (!(await page.locator('[data-testid="who"]').count())) throw new Error("the name must be correctable before approval");
    await fillExact(page, '[data-testid="short-version"]', "I got three new clients without chasing anyone.");
    await submit(page, 'button:has-text("Save")');
    await page.waitForURL(/notVerbatim=shortVersion/);
    await expectText(page, "isn't a trim of the quote", "rewrite refused");
    await fillExact(page, '[data-testid="who"]', "Jess Morgan-Lee");
    await fillExact(page, '[data-testid="short-version"]', "three new clients this month… didn't chase a single one.");
    await fillExact(page, '[data-testid="hook"]', "She 3x'd her client list in a month without chasing anyone.");
    await submit(page, 'button:has-text("Save")');
    if (/notVerbatim/.test(page.url())) throw new Error("a trim with an ellipsis, and a hook in the client's own words, must be accepted");
    await expectText(page, "three new clients this month… didn't chase a single one.” — Jess M.", "copy-out carries the attribution (the corrected name)");
    if ((await page.inputValue('[data-testid="who"]')) !== "Jess Morgan-Lee") throw new Error("the corrected name must be saved while a draft");
    const frame = await page.locator('[data-testid="copy-frame"]').innerText();
    if (/— Jess/.test(frame)) throw new Error("the hook is the client's framing and must not be attributed to the customer");
    console.log("✓ rewrite refused, trim accepted, attribution attached to every copy");

    // Tick two: no tick, no approval; ticked, approved with the exact wording and a date
    const tickTwo = (await page.locator('[data-testid="permission-tick"]').innerText()).replace(/\s+/g, " ").trim();
    if (tickTwo !== TICK_TWO) throw new Error(`tick two wording differs:\n${tickTwo}`);
    await submit(page, '[data-testid="approve"]');
    await page.waitForURL(/needsPermission=1/);
    await expectText(page, "tick the permission line first", "no tick, no approval");
    await page.check('[data-testid="permission-tick"] input');
    await submit(page, '[data-testid="approve"]');
    await expectText(page, "Ticked", "approved with a date");
    if (!(await page.locator('[data-testid="permission-record"]').count())) throw new Error("the tick must be recorded");
    if (!(await page.locator('[data-testid="who-readonly"]').count())) throw new Error("once approved the name is fixed");
    await page.screenshot({ path: "screenshots/f03-proof-approved.png", fullPage: true });
    console.log("✓ tick two gates approval, recorded with the date; the name is fixed once approved");

    // The same tick gates a typed proof, and proofs approved before the tick existed stay approved
    await page.goto(`${base}/proof`);
    await expectText(page, "3 approved before the permission tick", "grandfathered rows counted");
    await page.click('a:has-text("Dana\'s first full week")');
    await page.waitForURL(/\/proof\/[a-z0-9-]+$/i);
    if (await page.locator('select[name="status"]').count()) throw new Error("status must not be settable from the form");
    await submit(page, '[data-testid="approve"]');
    await page.waitForURL(/needsPermission=1/);
    await page.check('[data-testid="permission-tick"] input');
    await submit(page, '[data-testid="approve"]');
    await expectText(page, "Dana has given me permission", "typed proof approved through the same tick");
    await page.goto(`${base}/proof`);
    await expectText(page, "5 approved to use", "count after approvals");
    await expectText(page, "3 approved before the permission tick", "grandfathered rows unchanged");
    console.log("✓ the tick gates typed proofs too; earlier approvals untouched and counted");

    // Approved: the composer offers it with the name; the webinar belief step lists it
    await page.goto(`${base}/content/compose`);
    const proofOption = await page.locator('select[aria-label="Pick a proof from the bank"] option:has-text("Jess M.")').first().getAttribute("value");
    if (!proofOption) throw new Error("the approved proof must be offered in the composer");
    await page.selectOption('select[aria-label="Pick a proof from the bank"]', proofOption);
    const body = await page.inputValue('textarea[placeholder^="Type content"]');
    if (!body.includes("— Jess M.")) throw new Error(`composer insert must carry the attribution: ${body}`);
    await page.goto(`${base}/webinars`);
    await page.click('a:has-text("The Leaky Webinar")');
    await page.waitForURL(/\/webinars\//);
    await page.goto(`${page.url().split("?")[0]}?step=beliefs`);
    if (!(await page.locator('[data-testid="belief-proof-vehicle"] option:has-text("Jess M.")').count())) throw new Error("the webinar belief step must offer the approved proof");
    await page.selectOption('[data-testid="belief-proof-vehicle"]', { label: (await page.locator('[data-testid="belief-proof-vehicle"] option:has-text("Jess M.")').first().innerText()).trim() });
    await submit(page, 'button:has-text("Save")');
    console.log("✓ approved proof reaches the composer with its name and the webinar belief step");

    const allReads = await reads();
    if (allReads.join(",") !== "180896622") throw new Error(`nothing else was allowed to read a recording; reads: ${allReads.join(",")}`);
  } finally {
    await browser.close();
    for (const m of [fathom, ai]) {
      try {
        if (m.pid) process.kill(-m.pid, "SIGTERM");
      } catch {
        m.kill();
      }
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Fathom smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
