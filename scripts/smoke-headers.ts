/** Security headers walk: visits every main page as client and coach and fails on any Content-Security-Policy violation or page error the browser reports. Also prints the headers. */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
// Every page the app routes to, read off src/app/(app): a path here that answers anything but 200 fails the walk, so a renamed page is caught rather than "checked" as a 404.
const PAGES_CLIENT = ["/today", "/tasks", "/content", "/content/compose", "/content/ladders", "/library", "/conversations", "/groups", "/webinars", "/offers", "/pathway", "/courses", "/doctrine", "/proof", "/evidence", "/essence", "/magnets", "/socrates", "/clients", "/community", "/numbers", "/rewards", "/more", "/settings"];
const PAGES_COACH = ["/coach", "/integrations", "/certification", "/settings"];

async function main() {
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`${base}/login`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const problems: string[] = [];
  const page = await (await browser.newContext()).newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) problems.push(`${page.url()}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`${page.url()}: pageerror ${e.message.slice(0, 200)}`));
  let visited = 0;
  const visit = async (paths: string[]) => {
    for (const p of paths) {
      const res = await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
      // No violations on a page that did not load is no finding: every page must answer 200 before its console counts.
      if (!res || res.status() !== 200) throw new Error(`${p} answered ${res?.status() ?? "nothing"}; a page that did not load cannot be checked`);
      visited++;
      await page.waitForTimeout(300);
    }
  };
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
  await visit(PAGES_CLIENT);
  // interact a little so client-side handlers run under the policy
  await page.goto(`${base}/content/compose`, { waitUntil: "networkidle" });
  await page.fill('textarea[placeholder^="Type content"]', "CSP check body");
  await page.waitForTimeout(500);
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await visit(PAGES_COACH);
  await browser.close();
  if (problems.length) {
    console.error("CSP / page problems:\n" + problems.join("\n"));
    process.exit(1);
  }
  if (visited !== PAGES_CLIENT.length + PAGES_COACH.length) throw new Error(`visited ${visited} of ${PAGES_CLIENT.length + PAGES_COACH.length} pages`);
  console.log(`CSP check passed: ${visited} pages loaded, no violations, no page errors`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
