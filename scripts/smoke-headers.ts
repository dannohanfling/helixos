/** Security headers walk: visits every main page as client and coach and fails on any Content-Security-Policy violation or page error the browser reports. Also prints the headers. */
import { readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
/**
 * Phones (Danno, 12 Oct): at 360 and 390 wide, every page is exactly the screen's width. Measured with the html/body
 * overflow-x clip taken away, so a cause can't hide behind the safety net; an element inside its own scroller (a table or a row
 * of tabs that scrolls sideways on purpose) doesn't count, nor the contents of a closed disclosure. Plain JS: a named function
 * here would reach the browser as tsx's __name helper.
 */
const PHONE_WIDTHS = [390, 360];
const MEASURE = `(() => {
  const net = document.createElement("style");
  net.textContent = "html,body{overflow-x:visible !important}";
  document.head.appendChild(net);
  const vw = window.innerWidth;
  const docW = document.documentElement.scrollWidth;
  const inScroller = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowX !== "visible") return true; } return false; };
  const wide = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1 || inScroller(el)) continue;
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    if (Array.from(el.children).some((c) => c.getBoundingClientRect().right > vw + 1 && !inScroller(c))) continue;
    const id = el.getAttribute("data-testid");
    wide.push(el.tagName.toLowerCase() + (id ? "[" + id + "]" : "") + " right " + Math.round(r.right) + 'px "' + (el.textContent || "").trim().slice(0, 30) + '"');
  }
  net.remove();
  window.scrollTo(400, 0);
  const panned = window.scrollX;
  window.scrollTo(0, 0);
  return { vw, docW, panned, wide: wide.slice(0, 4) };
})()`;
/** Every static page under src/app/(app), read off the tree: a dynamic segment ([id]) needs a record and is walked elsewhere. */
function routedPages(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("[")) continue;
    const path = `${prefix}/${entry.name}`;
    if (existsSync(join(dir, entry.name, "page.tsx"))) out.push(path);
    out.push(...routedPages(join(dir, entry.name), path));
  }
  return out.sort();
}
// The two lists say who visits which page; the source of truth is the tree, and the lists are asserted against it before a page is visited.
const PAGES_CLIENT = ["/today", "/bot-features", "/intentions", "/connect", "/oauth/authorize", "/oauth/authorize/return", "/body", "/body/foods", "/body/foods/find", "/body/settings", "/body/training", "/body/training/routines", "/body/weight", "/body/goals", "/body/pantry", "/body/week", "/body/import", "/body/practices", "/body/practices/meds", "/body/sleep", "/body/training/health", "/body/insights", "/body/shopping", "/tasks", "/content", "/content/compose", "/content/ladders", "/content/ladders/profile", "/library", "/conversations", "/conversations/playbook", "/groups", "/office-hours", "/webinars", "/images", "/brain", "/my-board", "/my-board/council", "/offers", "/avatars", "/pathway", "/courses", "/recordings", "/doctrine", "/proof", "/proof/harvest", "/evidence", "/essence", "/magnets", "/socrates", "/socrates/foundations", "/socrates/objections", "/socrates/questions", "/socrates/reframes", "/socrates/scripts", "/clients", "/community", "/numbers", "/goals", "/rewards", "/more", "/settings", "/whats-new"];
const PAGES_COACH = ["/coach", "/coach/community", "/coach/feedback", "/coach/move", "/coach/import", "/coach/headshots", "/coach/late-closes", "/coach/teaching", "/coach/bot-features", "/coach/backfill", "/coach/office-hours", "/coach/board", "/coach/board-seats", "/coach/recordings", "/coach/recordings/rules", "/coach/reports", "/integrations", "/integrations/planner-audit", "/certification", "/settings"];

async function main() {
  const routed = routedPages("src/app/(app)");
  const listed = [...new Set([...PAGES_CLIENT, ...PAGES_COACH])].sort();
  if (JSON.stringify(listed) !== JSON.stringify(routed)) throw new Error(`the walk's page lists drifted from src/app/(app): listed ${listed.length}, routed ${routed.length}; missing ${routed.filter((p) => !listed.includes(p)).join(", ") || "none"}; stale ${listed.filter((p) => !routed.includes(p)).join(", ") || "none"}`);
  // This walk has the dev server compile every page there is. After the walks before it in the gate, that compile climbed
  // past what the machine allows (1 Oct: the kernel killed the server at 13 GB, twice, mid-walk), while a fresh server with a
  // clean cache walks all the pages in under 4 GB. So the walk starts from one, on the local server only.
  // 12 Oct: the pages have grown to where one server compiling all of them climbs to 12 GB and the kernel kills it at the last
  // few; so the coach's pages start from a fresh server too, each half well under the limit.
  const fresh = async () => {
    if (base === "http://localhost:3000") {
      execFileSync("scripts/dev-server.sh", ["stop"], { stdio: "pipe" });
      rmSync(".next/dev", { recursive: true, force: true });
      execFileSync("scripts/dev-server.sh", ["start"], { stdio: "pipe" });
    }
    for (let i = 0; i < 40; i++) {
      const ok = await fetch(`${base}/login`).then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  };
  await fresh();
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const problems: string[] = [];
  // A phone, so the pages lay out the way an iPhone lays them out (the security headers are the same at any size).
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const tooWide: string[] = [];
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
      // The camera is allowed on Find a food alone (Body, rev 237 phase 13), where a barcode is scanned; every other page says none.
      const policy = res.headers()["permissions-policy"] ?? "";
      const wantCamera = p === "/body/foods/find" ? "camera=(self)" : "camera=()";
      if (!policy.includes(wantCamera)) throw new Error(`${p}: Permissions-Policy "${policy}" should carry ${wantCamera}`);
      visited++;
      await page.waitForTimeout(300);
      for (const w of PHONE_WIDTHS) {
        await page.setViewportSize({ width: w, height: 844 });
        await page.waitForTimeout(150);
        const m = (await page.evaluate(MEASURE)) as { vw: number; docW: number; panned: number; wide: string[] };
        if (m.docW > m.vw || m.panned > 0 || m.wide.length) tooWide.push(`${p} at ${w}px: page ${m.docW}px wide, pans ${m.panned}px; ${m.wide.join("; ") || "no single element"}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
    }
  };
  // Body ships dark (rev 195): switched on for the demo client, by the same script used in production, so its pages load and count.
  execFileSync("npx", ["tsx", "scripts/body-flag.ts", "client@demo.helixos.app", "on", "--apply"], { stdio: "pipe" });
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
  await visit(PAGES_CLIENT);
  // Coming soon (rev 816): six greyed items on More, none a link, each disabled for screen readers and at least 44px tall;
  // a tap shows the subtitle and goes nowhere.
  {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/more`, { waitUntil: "networkidle" });
    const soon = page.locator('main [data-testid="nav-coming-soon"]');
    if ((await soon.count()) !== 6) throw new Error(`six Coming soon items on More: ${await soon.count()}`);
    for (let i = 0; i < 6; i++) {
      const it = soon.nth(i);
      const box = await it.boundingBox();
      if ((await it.getAttribute("aria-disabled")) !== "true" || (await it.evaluate("(el) => el.closest('a') !== null")) || !box || box.height < 44 || box.x + box.width > 390.5) throw new Error(`a Coming soon item is a link, isn't marked disabled, or is too small or too wide: ${await it.innerText()}`);
    }
    const here = page.url();
    await soon.filter({ hasText: "The Forum" }).click({ force: true }); // aria-disabled: Playwright waits for "enabled", a finger doesn't
    if (!(await soon.filter({ hasText: "The Forum" }).locator('[data-testid="nav-coming-soon-line"]').isVisible()) || page.url() !== here) throw new Error("tapping a Coming soon item should show its subtitle and go nowhere");
    console.log("✓ Coming soon: six greyed items on More, none a link, disabled for screen readers, 44px or taller, within the screen; a tap shows the subtitle and stays put");
  }
  // interact a little so client-side handlers run under the policy
  await page.goto(`${base}/content/compose`, { waitUntil: "networkidle" });
  await page.fill('textarea[placeholder^="Type content"]', "CSP check body");
  await page.waitForTimeout(500);
  await fresh();
  await page.goto(`${base}/settings`);
  await page.click('[data-testid="logout-header"]');
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
  if (tooWide.length) throw new Error(`wider than a phone's screen:\n${tooWide.join("\n")}`);
  console.log(`✓ phones: all ${visited} pages exactly the screen's width at ${PHONE_WIDTHS.join(" and ")}px, no sideways scroll`);
  console.log(`CSP check passed: ${visited} pages loaded, no violations, no page errors`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
