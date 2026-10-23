/**
 * The Office Hours screenshot (H-1706), at runtime, against the running dev server and scripts/mock-blob.ts on :4050:
 *  1. Maya asks for help with an uploaded picture: it is shrunk in the browser, checked by its bytes on the server and kept
 *     privately under ooh/<workspace>/; her request card shows it, and the private link opens it for her.
 *  2. The coach's queue shows the picture and the link opens for the coach; another client gets the same 404 as for nothing.
 *  3. Maya replaces the picture (the old object is deleted), then removes it (the request keeps its words, the object goes).
 *  4. A file that isn't a picture is refused in the browser in plain words, and the typing stays.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3000";
const blob = "http://localhost:4050";

const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, scope: ReturnType<Page["locator"]>) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), scope.locator('[data-testid="ooh-submit"]').click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}
const stored = async () => ((await (await fetch(`${blob}/__list`)).json()) as { objects: { pathname: string; access: string }[] }).objects;
const picture = (r: number, g: number, b: number) => sharp({ create: { width: 2400, height: 1500, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  const up = await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${blob}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));

  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const watch = (page: Page) => {
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  };
  const run = randomUUID().slice(0, 8);
  let requestId = "";
  try {
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!.workspaceId;

    // ── 1. Maya asks with a picture. ──
    const owner = await browser.newPage({ viewport: { width: 1350, height: 950 } });
    watch(owner);
    await owner.goto(`${base}/login`);
    await owner.click('button:has-text("As a client")');
    await owner.waitForURL(/\/today/);
    await owner.goto(`${base}/office-hours`);
    const form = owner.locator("#request").locator('[data-testid="ooh-form"]');
    await form.waitFor({ timeout: 20000 });
    must(await form.locator('[data-testid="ooh-shot-field"]').count(), "the form has the screenshot field");
    must((await form.locator('[data-testid="ooh-shot-field"]').innerText()).includes("Hide anyone's details who hasn't agreed"), "the consent line sits under the field");
    await form.locator('[data-testid="ooh-description"]').fill(`Screenshot walk ${run}: the booking widget shows the wrong week.`);
    await form.locator('[data-testid="ooh-tried"]').fill("Cleared the cache and re-saved the calendar.");
    await form.locator('[data-testid="ooh-goal"]').fill("Bookings show the right week.");
    await form.locator('[data-testid="ooh-category"]').selectOption({ index: 1 });
    await form.locator('[data-testid="ooh-gate-yes"]').check();
    await form.locator('[data-testid="ooh-promise"]').check();
    // 4. first: a file that isn't a picture is refused in the browser, in words, and nothing is attached.
    await form.locator('[data-testid="ooh-screenshot"]').setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("just some text, renamed") });
    await form.getByText("That picture couldn't be read").waitFor({ timeout: 10000 });
    must(!(await form.locator('[data-testid="ooh-preview"]').count()) && (await form.locator('[data-testid="ooh-carrier"]').inputValue()) === "", "nothing is attached after a refusal");
    must((await form.locator('[data-testid="ooh-description"]').inputValue()).includes(`Screenshot walk ${run}`), "the typing stays after a refusal");
    console.log("✓ a file that isn't a picture is refused in the browser in plain words; nothing attached, the typing kept");

    await form.locator('[data-testid="ooh-screenshot"]').setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: await picture(30, 110, 200) });
    await form.locator('[data-testid="ooh-preview"]').waitFor({ timeout: 10000 });
    await owner.waitForFunction(() => ((document.querySelector('#request [data-testid="ooh-carrier"]') as HTMLInputElement | null)?.value ?? "").startsWith("data:image/jpeg;base64,"), undefined, { timeout: 10000 });
    await submit(owner, form);
    await owner.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
    must(!(await owner.locator('[data-testid="ooh-shot-not-kept"]').count()), "the picture was kept");
    const req = (await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) })).find((r) => r.description.includes(`Screenshot walk ${run}`))!;
    requestId = req.id;
    must(new RegExp(`^ooh/${ws}/${req.id}-[0-9a-f]{8}\\.jpg$`).test(req.screenshotKey ?? "") && req.screenshotType === "image/jpeg", `kept privately under ooh/ as a JPEG: ${req.screenshotKey} ${req.screenshotType}`);
    const first = (await stored()).find((o) => o.pathname === req.screenshotKey);
    must(first && first.access === "private", "the object is private in the store");
    const card = owner.locator('[data-testid="ooh-mine"]', { hasText: `Screenshot walk ${run}` });
    const thumb = card.locator('[data-testid="ooh-mine-shot"] img');
    await thumb.waitFor({ timeout: 20000 });
    await owner.waitForFunction((id) => [...document.querySelectorAll<HTMLImageElement>(`img[src="/api/office-hours/${id}/screenshot"]`)].some((i) => i.complete && i.naturalWidth > 0), req.id, { timeout: 15000 });
    must(await thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth === 1600), "the picture shows on her card, shrunk to 1600 wide");
    const mine = await owner.request.get(`${base}/api/office-hours/${req.id}/screenshot`);
    must(mine.status() === 200 && mine.headers()["content-type"] === "image/jpeg" && mine.headers()["cache-control"] === "private, no-store", `the private link opens for her (${mine.status()})`);
    console.log("✓ a request with an uploaded picture: shrunk in the browser, checked by its bytes, private under ooh/, on her card, opens for her");

    // ── 2. The coach sees it; another client gets the same 404 as for nothing. ──
    const coach = await browser.newPage({ viewport: { width: 1350, height: 950 } });
    watch(coach);
    await coach.goto(`${base}/login`);
    await coach.click('button:has-text("As the coach")');
    await coach.waitForURL(/\/today/);
    await coach.goto(`${base}/coach/office-hours`);
    const coachCard = coach.locator('[data-testid="ooh-request"]', { hasText: `Screenshot walk ${run}` });
    await coachCard.locator('[data-testid="ooh-coach-shot"] img').waitFor({ timeout: 20000 });
    must((await coachCard.locator('[data-testid="ooh-coach-shot"]').getAttribute("target")) === "_blank", "the coach's thumbnail opens full size in a new tab");
    must((await coach.request.get(`${base}/api/office-hours/${req.id}/screenshot`)).status() === 200, "the link opens for the coach");
    const other = await browser.newPage();
    watch(other);
    await other.goto(`${base}/login`);
    await other.fill('input[name="email"]', "client2@demo.helixos.app");
    await other.fill('input[name="password"]', "demo1234");
    await other.click('button[type="submit"]:has-text("Sign in")');
    await other.waitForURL(/\/today/);
    const theirs = await other.request.get(`${base}/api/office-hours/${req.id}/screenshot`);
    const nothing = await other.request.get(`${base}/api/office-hours/${randomUUID()}/screenshot`);
    must(theirs.status() === 404 && nothing.status() === 404 && (await theirs.text()) === (await nothing.text()), "another client gets the same 404 as for nothing at all");
    console.log("✓ the coach's queue shows the picture and opens it; another client gets the same 404 as for nothing");

    // ── 3. Replace, then remove. ──
    await owner.goto(`${base}/office-hours`);
    const mineCard = owner.locator('[data-testid="ooh-mine"]', { hasText: `Screenshot walk ${run}` });
    await mineCard.locator('[data-testid="ooh-edit"]').click();
    const edit = mineCard.locator('[data-testid="ooh-form"]');
    await edit.locator('[data-testid="ooh-edit-current"]').waitFor({ timeout: 10000 });
    await edit.locator('[data-testid="ooh-edit-screenshot"]').setInputFiles({ name: "again.png", mimeType: "image/png", buffer: await picture(200, 60, 40) });
    await edit.locator('[data-testid="ooh-edit-preview"]').waitFor({ timeout: 10000 });
    await owner.waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('[data-testid="ooh-edit-carrier"]')].some((i) => i.value.startsWith("data:image/jpeg;base64,")), undefined, { timeout: 10000 });
    await submit(owner, edit);
    await owner.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
    const replaced = (await db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.id, req.id) }))!;
    const objects = (await stored()).map((o) => o.pathname);
    must(replaced.screenshotKey && replaced.screenshotKey !== req.screenshotKey && objects.includes(replaced.screenshotKey) && !objects.includes(req.screenshotKey!), "a new picture replaces the old, and the old object is deleted");
    await owner.goto(`${base}/office-hours`);
    const again = owner.locator('[data-testid="ooh-mine"]', { hasText: `Screenshot walk ${run}` });
    await again.locator('[data-testid="ooh-edit"]').click();
    const edit2 = again.locator('[data-testid="ooh-form"]');
    await edit2.locator('[data-testid="ooh-edit-remove"]').check();
    await submit(owner, edit2);
    await owner.locator('[data-testid="ooh-saved"]').waitFor({ timeout: 20000 });
    const removed = (await db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.id, req.id) }))!;
    must(!removed.screenshotKey && !removed.screenshotUrl && removed.description.includes(`Screenshot walk ${run}`), "removing the picture keeps the words");
    must(!(await stored()).some((o) => o.pathname === replaced.screenshotKey), "the removed picture's object is deleted");
    must(!(await owner.locator('[data-testid="ooh-mine"]', { hasText: `Screenshot walk ${run}` }).locator('[data-testid="ooh-mine-shot"]').count()), "the card no longer shows a picture");
    must((await owner.request.get(`${base}/api/office-hours/${req.id}/screenshot`)).status() === 404, "the link answers 404 once the picture is gone");
    console.log("✓ replace deletes the old picture; remove keeps the request's words and deletes the object");
  } finally {
    await browser.close();
    if (requestId) await db.delete(schema.officeHoursRequests).where(eq(schema.officeHoursRequests.id, requestId)).catch(() => undefined);
    if (proc?.pid)
      try {
        process.kill(-proc.pid);
      } catch {
        /* already gone */
      }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Office Hours screenshot walk passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
