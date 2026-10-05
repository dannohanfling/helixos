/** Security headers walk: visits every main page as client and coach and fails on any Content-Security-Policy violation or page error the browser reports. Also prints the headers. */
import { readdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
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
const PAGES_CLIENT = ["/today", "/intentions", "/connect", "/oauth/authorize", "/oauth/authorize/return", "/body", "/body/foods", "/body/foods/find", "/body/settings", "/body/training", "/body/training/routines", "/body/weight", "/body/pantry", "/body/week", "/body/import", "/body/practices", "/body/practices/meds", "/body/sleep", "/body/training/health", "/body/insights", "/body/shopping", "/tasks", "/content", "/content/compose", "/content/ladders", "/content/ladders/profile", "/library", "/conversations", "/conversations/playbook", "/groups", "/office-hours", "/webinars", "/images", "/brain", "/offers", "/avatars", "/pathway", "/courses", "/recordings", "/doctrine", "/proof", "/proof/harvest", "/evidence", "/essence", "/magnets", "/socrates", "/socrates/foundations", "/socrates/objections", "/socrates/questions", "/socrates/reframes", "/socrates/scripts", "/clients", "/community", "/numbers", "/rewards", "/more", "/settings", "/whats-new"];
const PAGES_COACH = ["/coach", "/coach/community", "/coach/feedback", "/coach/move", "/coach/import", "/coach/backfill", "/coach/office-hours", "/coach/recordings", "/coach/recordings/rules", "/coach/reports", "/integrations", "/integrations/planner-audit", "/certification", "/settings"];

async function main() {
  const routed = routedPages("src/app/(app)");
  const listed = [...new Set([...PAGES_CLIENT, ...PAGES_COACH])].sort();
  if (JSON.stringify(listed) !== JSON.stringify(routed)) throw new Error(`the walk's page lists drifted from src/app/(app): listed ${listed.length}, routed ${routed.length}; missing ${routed.filter((p) => !listed.includes(p)).join(", ") || "none"}; stale ${listed.filter((p) => !routed.includes(p)).join(", ") || "none"}`);
  // This walk has the dev server compile every page there is. After the walks before it in the gate, that compile climbed
  // past what the machine allows (1 Oct: the kernel killed the server at 13 GB, twice, mid-walk), while a fresh server with a
  // clean cache walks all the pages in under 4 GB. So the walk starts from one, on the local server only.
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
      // The camera is allowed on Find a food alone (Body, rev 237 phase 13), where a barcode is scanned; every other page says none.
      const policy = res.headers()["permissions-policy"] ?? "";
      const wantCamera = p === "/body/foods/find" ? "camera=(self)" : "camera=()";
      if (!policy.includes(wantCamera)) throw new Error(`${p}: Permissions-Policy "${policy}" should carry ${wantCamera}`);
      visited++;
      await page.waitForTimeout(300);
    }
  };
  // Body ships dark (rev 195): switched on for the demo client, by the same script used in production, so its pages load and count.
  execFileSync("npx", ["tsx", "scripts/body-flag.ts", "client@demo.helixos.app", "on", "--apply"], { stdio: "pipe" });
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
