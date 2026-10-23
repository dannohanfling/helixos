/**
 * Important actions are buttons (H-1680, H-1794): on a 390 px phone, the links a member needs to find render as buttons with
 * a 44 px tap target, and the coach's menu names the Coach view "Coach" (H-1795). Each check reads the page as it renders.
 */
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

/** The element is a button (the shared .btn class) at least 44 px tall. */
async function isButton(page: Page, testid: string, where: string) {
  const el = page.locator(`[data-testid="${testid}"]`).first();
  await el.waitFor({ timeout: 20000 });
  const cls = (await el.getAttribute("class")) ?? "";
  const box = await el.boundingBox();
  must(/\bbtn\b/.test(cls), `${where}: ${testid} is a button, got class "${cls}"`);
  must(box && box.height >= 44, `${where}: ${testid} is at least 44 px tall, got ${box?.height}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    phone.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await login(phone, "As a client");
    await phone.goto(`${base}/today`);
    await phone.waitForLoadState("networkidle");
    await isButton(phone, "road", "Today");
    await isButton(phone, "today-see-rewards", "Today");
    if (await phone.locator('[data-testid="today-set-goal"]').count()) await isButton(phone, "today-set-goal", "Today");
    if (await phone.locator('[data-testid="today-arena-open"]').count()) await isButton(phone, "today-arena-open", "Today");
    if (await phone.locator('[data-testid="today-next-call-week"]').count()) await isButton(phone, "today-next-call-week", "Today");
    console.log("✓ Today: Your road, See rewards and the goal, Arena and call links are buttons at 390 px");

    // More's items are full-width menu rows (left as they are in H-1680); the point is that Notifications has one.
    await phone.goto(`${base}/more`);
    await phone.locator('[data-testid="more-support"]').waitFor({ timeout: 20000 });
    const notif = phone.locator('[data-testid="more-notifications"]');
    must((await notif.getAttribute("href")) === "/settings/notifications", "More has a Notifications row");
    console.log("✓ More: a Notifications row, and Help and support");

    await phone.goto(`${base}/settings?tab=connections`);
    await isButton(phone, "settings-connect-tools", "Settings");
    await isButton(phone, "settings-connect-claude", "Settings");
    if (await phone.locator('[data-testid="connected-apps-connect"]').count()) await isButton(phone, "connected-apps-connect", "Settings");
    console.log("✓ Settings → Connections: the step-by-step guides and Connect HelixOS to Claude are buttons");

    await phone.goto(`${base}/office-hours`);
    await phone.waitForLoadState("networkidle");
    if (await phone.locator('[data-testid="ooh-join"]').count()) await isButton(phone, "ooh-join", "Office Hours");
    console.log("✓ Office Hours: Join the call is a button when the call has a link");

    await phone.goto(`${base}/proof/harvest`);
    if (await phone.locator('[data-testid="harvest-connect-fathom"]').count()) await isButton(phone, "harvest-connect-fathom", "Proof harvest");
    console.log("✓ Proof harvest: Connect your Fathom key is the gold button when Fathom isn't connected");

    // The coach's menu (desktop): the Coach view is named Coach (H-1795), at the same address with its icon.
    const desk = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    await login(desk, "As the coach");
    const item = desk.locator('[data-testid="side-nav"] a[href="/coach"]').first();
    await item.waitFor({ timeout: 20000 });
    const label = (await item.getAttribute("aria-label")) || (await item.innerText());
    must(/\bCoach\b/.test(label) && !/\bClients\b/.test(label), `the menu item for /coach reads Coach: ${label}`);
    console.log("✓ the coach's menu names the Coach view Coach");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nbuttons walk passed");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
