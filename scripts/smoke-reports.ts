/**
 * "I have an issue or a suggestion" and the coach's inbox (rev 432 items 2 to 4): a client sends an issue with a screenshot from
 * Today (shrunk in the browser, checked by its bytes, kept private under reports/), an Ask Danno answer from Tasks with the
 * wish to talk, and an idea from More; a picture that isn't one is refused in words. The coach sees the counts in the menu, on
 * the Coach page and on Today, the inbox newest first with the screenshot, Seen and Done; only the coach and the sender can open
 * the screenshot. New monthly feedback is counted until the coach opens Monthly feedback. A coach switched into a client has no
 * button. Against scripts/mock-blob.ts on :4050 (dev-server.sh sets the store's tokens).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3000";
const blob = "http://localhost:4050";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function loginAs(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "demo1234");
  await Promise.all([page.waitForURL(/\/today/), page.click('button[type="submit"]')]);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
async function fillChecked(page: Page, selector: string, value: string) {
  for (let i = 0; i < 6; i++) {
    await page.locator(selector).fill(value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const up = await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = mayaM.workspaceId;
    const coachFirst = coachU.name.split(" ")[0];
    const reports = () => db.query.memberReports.findMany({ where: eq(schema.memberReports.workspaceId, ws), orderBy: desc(schema.memberReports.createdAt) });
    must((await reports()).length === 0, "no reports to begin with");
    const png = await sharp({ create: { width: 2400, height: 1500, channels: 3, background: { r: 30, g: 110, b: 200 } } }).png().toBuffer();

    // ── 1. A client: an issue with a screenshot from Today; a picture that isn't one refused in words. ──
    await login(page, "As a client");
    await page.locator('[data-testid="report-open"]').first().click();
    const dialog = page.locator('dialog[open][data-testid="report-dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    must((await dialog.innerText()).includes(`Tell ${coachFirst}`), "the dialog names the coach");
    must((await dialog.innerText()).includes("The page you're on goes with it: /today"), "the page it came from is shown and goes with it");
    await page.locator('dialog[open] [data-testid="report-screenshot"]').setInputFiles({ name: "not-a-picture.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)>") });
    await dialog.getByText("That picture couldn't be read").waitFor({ timeout: 10000 });
    await page.locator('dialog[open] [data-testid="report-kind-issue"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-red"]').check();
    const ISSUE = "The Save button on the month card did nothing on my phone, twice.";
    await fillChecked(page, 'dialog[open] [data-testid="report-description"]', ISSUE);
    await page.locator('dialog[open] [data-testid="report-screenshot"]').setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: png });
    await page.locator('dialog[open] [data-testid="report-preview"]').waitFor({ timeout: 10000 });
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    must((await page.locator('dialog[open] [data-testid="report-sent"]').innerText()).includes("The screenshot went with it"), "the sent panel says the screenshot went");
    const issue = (await reports())[0];
    must(issue && issue.kind === "issue" && issue.severity === "red" && issue.description === ISSUE && issue.page === "/today" && issue.userId === maya.id, `the issue is stored as sent: ${JSON.stringify(issue)}`);
    must(issue.screenshotKey === `reports/${ws}/${issue.id}.jpg` && issue.screenshotType === "image/jpeg", "the screenshot was shrunk to a JPEG and kept under reports/");
    const stored = ((await (await fetch(`${blob}/__list`)).json()) as { objects: { pathname: string; access: string; size: number }[] }).objects.find((o) => o.pathname === issue.screenshotKey);
    must(stored && stored.access === "private" && stored.size < 950_000 && stored.size > 1000, `the picture is in the private store, under the size a form may send: ${JSON.stringify(stored)}`);
    await page.locator('dialog[open] button:has-text("Close")').click();
    console.log("✓ an issue from Today with a screenshot: shrunk in the browser, checked by its bytes, private under reports/; a picture that isn't one refused in words");

    // ── 2. An Ask Danno answer from Tasks, with the wish to talk; an idea from More. ──
    await page.goto(`${base}/tasks`);
    await page.locator('[data-testid="report-open"]').first().click();
    await page.locator('dialog[open] [data-testid="report-kind-ask_danno"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-orange"]').check();
    await fillChecked(page, 'dialog[open] [data-testid="report-question"]', "How many rungs should a comment ladder have?");
    await fillChecked(page, 'dialog[open] [data-testid="report-answer"]', "Twelve, always.");
    await page.locator('dialog[open] [data-testid="report-talk"]').check();
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    const ask = (await reports())[0];
    must(ask.kind === "ask_danno" && ask.page === "/tasks" && ask.question === "How many rungs should a comment ladder have?" && ask.answer === "Twelve, always." && ask.talkToCoach === true && !ask.screenshotKey, `the Ask Danno answer is stored with the wish to talk: ${JSON.stringify(ask)}`);
    await page.goto(`${base}/more`);
    await page.locator('[data-testid="report-open"]').first().click();
    await page.locator('dialog[open] [data-testid="report-kind-suggestion"]').check();
    await page.locator('dialog[open] [data-testid="report-severity-green"]').check();
    await fillChecked(page, 'dialog[open] [data-testid="report-description"]', "A dark mode for late nights.");
    await page.locator('dialog[open] [data-testid="report-send"]').click();
    await page.locator('dialog[open] [data-testid="report-sent"]').waitFor({ timeout: 20000 });
    must((await reports())[0].kind === "suggestion" && (await reports())[0].page === "/more", "the idea from More is stored");
    must((await reports()).length === 3, "three reports in all");
    await logout(page);
    console.log("✓ an Ask Danno answer from Tasks with the question, the answer and the wish to talk; an idea from More");

    // ── 3. New monthly feedback, sent as a member would, before the coach looks. ──
    const month = new Date().toISOString().slice(0, 7);
    await db.delete(schema.monthlyFeedback).where(and(eq(schema.monthlyFeedback.userId, jordan.id), eq(schema.monthlyFeedback.month, month)));
    await db.insert(schema.monthlyFeedback).values({ id: newId(), workspaceId: ws, userId: jordan.id, month, proud: "Booking my first two calls.", love: "The lock-in.", less: "Nothing.", more: "Office Hours.", wow: "The deck.", referralScore: 9, favorite: "The community." });
    const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coachU.id) }))!;
    await db.update(schema.memberships).set({ feedbackSeenAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(schema.memberships.id, coachM.id));

    // ── 4. The coach: counts in the menu, on Today and on the Coach page; the inbox; Seen and Done; the screenshot. ──
    await login(page, "As the coach");
    must((await page.locator('aside a[href="/coach/reports"]').innerText()).includes("3"), "the menu counts three issues and ideas");
    must((await page.locator('[data-testid="coach-new-reports"]').innerText()).includes("3 new issues and ideas"), "Today says three new issues and ideas");
    must((await page.locator('[data-testid="coach-new-feedback"]').innerText()).includes("1 new monthly feedback"), "Today says one new monthly feedback");
    must(!(await page.locator('[data-testid="report-open"]').count()), "the coach has the inbox, not the button");
    await page.goto(`${base}/coach`);
    must((await page.locator('[data-testid="coach-reports-new"]').innerText()) === "3 new" && (await page.locator('[data-testid="coach-feedback-new"]').innerText()) === "1 new", "the Coach page counts both");
    await page.goto(`${base}/coach/reports`);
    const rows = page.locator('[data-testid="report-row"]');
    await rows.first().waitFor({ timeout: 20000 });
    must((await rows.count()) === 3, "three in the inbox");
    must((await rows.nth(0).getAttribute("data-kind")) === "suggestion" && (await rows.nth(2).getAttribute("data-kind")) === "issue", "newest first");
    const issueRow = page.locator(`#r-${issue.id} [data-testid="report-row"]`);
    must((await issueRow.innerText()).includes(ISSUE) && (await issueRow.innerText()).includes("/today") && (await issueRow.innerText()).includes(maya.name), "the issue shows its words, its page and who sent it");
    const img = issueRow.locator('[data-testid="report-screenshot-img"]');
    await img.waitFor({ timeout: 10000 });
    for (let i = 0; i < 40 && !(await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)); i++) await page.waitForTimeout(150);
    must(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth === 1600), "the screenshot shows, shrunk to 1600 wide");
    const askRow = page.locator(`#r-${ask.id} [data-testid="report-row"]`);
    must((await askRow.innerText()).includes("wants to talk") && (await askRow.innerText()).includes("Twelve, always."), "the Ask Danno answer shows the answer and the wish to talk");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), issueRow.locator('[data-testid="report-seen"]').click()]);
    await page.waitForTimeout(600);
    must((await page.locator(`#r-${issue.id} [data-testid="report-row"]`).getAttribute("data-seen")) === "1", "Seen marks it");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(`#r-${ask.id} [data-testid="report-done"]`).click()]);
    await page.waitForTimeout(600);
    must(!(await page.locator(`#r-${ask.id}`).count()), "Done takes it off Open");
    await page.goto(`${base}/coach/reports?tab=done`);
    must((await page.locator(`#r-${ask.id} [data-testid="report-row"]`).getAttribute("data-done")) === "1" && (await page.locator(`#r-${ask.id} [data-testid="report-row"]`).getAttribute("data-seen")) === "1", "Done is on the Done tab, seen too");
    await page.goto(`${base}/today`);
    must((await page.locator('[data-testid="coach-new-reports"]').innerText()).includes("1 new issue and idea"), "two opened: one left new");
    const coachShot = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    must(coachShot.status() === 200 && coachShot.headers()["content-type"] === "image/jpeg", `the coach opens the screenshot (${coachShot.status()})`);
    console.log("✓ the coach: counts in the menu, on Today and on the Coach page; the inbox newest first with the screenshot; Seen and Done");

    // ── 5. Monthly feedback: new until the coach opens it. ──
    await page.goto(`${base}/coach/feedback`);
    must((await page.locator('[data-testid="feedback-proud"] li[data-new="1"]').count()) === 1, "the new response is marked new on the page");
    await page.goto(`${base}/coach`);
    must(!(await page.locator('[data-testid="coach-feedback-new"]').count()), "once opened, the count clears");
    console.log("✓ new monthly feedback is counted until the coach opens Monthly feedback, marked new there once");

    // ── 6. A switched coach has no button; the screenshot is the sender's and the coach's only. ──
    await page.goto(`${base}/coach/${mayaM.id}`);
    await submit(page, '[data-testid="switch-view"]');
    await page.locator('[data-testid="switch-banner"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="report-open"]').count()), "switched into a client, there's no button to send as them");
    const switchedShot = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    must(switchedShot.status() === 200, "switched into Maya, her own screenshot opens as hers");
    await submit(page, '[data-testid="switch-back"]');
    await logout(page);
    await loginAs(page, jordan.email);
    const theirs = await page.request.get(`${base}/api/reports/${issue.id}/screenshot`);
    const nothing = await page.request.get(`${base}/api/reports/${newId()}/screenshot`);
    must(theirs.status() === 404 && nothing.status() === 404 && (await theirs.text()) === (await nothing.text()), "another member gets the same 404 as for nothing at all");
    await logout(page);
    await login(page, "As a client");
    must((await page.request.get(`${base}/api/reports/${issue.id}/screenshot`)).status() === 200, "the sender opens their own");
    await logout(page);
    console.log("✓ a switched coach has no button; the screenshot opens for the coach and the sender, and reads as missing to anyone else");

    console.log("\nsmoke-reports: all checks passed");
  } finally {
    await browser.close();
    if (proc?.pid) {
      try {
        process.kill(-proc.pid);
      } catch {
        /* already gone */
      }
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
