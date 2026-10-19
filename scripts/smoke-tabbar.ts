/**
 * The phone tab bar stays at the bottom edge (H-1043, plan H-1046). At 390 px in phone mode, on a long inbox message, Today and
 * DMs: scrolled to the end and back, with Safari's toolbar collapsing and returning (a shorter window, then the full one), and
 * after a pinch-zoom in and out. After each, the bar's bottom is the window's bottom, nothing of the page shows below it, and
 * the page's last line ends above the bar. Chromium stands in for iOS Safari here; the phone is the real check.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  // A long plan in the coach's inbox, the kind Danno was reading: sixty bullets.
  const title = "Smoke: a long plan for the tab bar";
  const body = Array.from({ length: 60 }, (_, i) => `- Step ${i + 1}: a line long enough to wrap once on a phone, so the message runs well past one screen.`).join("\n");
  const top = await db.select({ n: sql<number>`COALESCE(MAX(${schema.handoffMessages.seq}), 0)` }).from(schema.handoffMessages).where(and(eq(schema.handoffMessages.workspaceId, cm.workspaceId), eq(schema.handoffMessages.userId, coach.id)));
  const msgId = crypto.randomUUID();
  await db.insert(schema.handoffMessages).values({ id: msgId, workspaceId: cm.workspaceId, userId: coach.id, seq: Number(top[0]?.n ?? 0) + 1, fromAgentId: null, toIds: ["danno"], kind: "plan", title, body });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    const failures: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });
    // Read on a full page load: the sign-in lands on Today by a client-side navigation, which leaves the head as React
    // rebuilt it; a phone opening HelixOS gets the server's HTML.
    await page.goto(`${base}/today`, { waitUntil: "domcontentloaded" });
    const vp = await page.evaluate(() => Array.from(document.querySelectorAll('meta[name="viewport"]')).map((m) => m.getAttribute("content") ?? "").join(" | "));
    must(/viewport-fit=cover/.test(vp), `the viewport meta carries viewport-fit=cover, so the safe-area insets are real (${vp || "no viewport meta"})`);

    // Where the bar sits and where the page ends, as the window sees them now.
    const read = (p: Page) =>
      p.evaluate(() => {
        const bar = document.querySelector('[data-testid="bottom-nav"]') as HTMLElement;
        const r = bar.getBoundingClientRect();
        const main = document.querySelector("main") as HTMLElement;
        const last = main.lastElementChild?.getBoundingClientRect();
        const doc = document.documentElement;
        return {
          h: window.innerHeight,
          top: r.top,
          bottom: r.bottom,
          style: bar.getAttribute("style") ?? "",
          lastBottom: last ? last.bottom : 0,
          below: doc.scrollHeight - (window.scrollY + window.innerHeight),
          atEnd: window.scrollY + window.innerHeight >= doc.scrollHeight - 1,
          sideways: doc.scrollWidth > window.innerWidth + 1,
        };
      });
    const check = async (where: string) => {
      await page.waitForTimeout(250);
      const s = await read(page);
      must(Math.abs(s.bottom - s.h) <= 1, `${where}: the bar's bottom is the window's bottom (${s.bottom.toFixed(1)} of ${s.h})`);
      must(s.top > s.h * 0.85, `${where}: the bar sits at the bottom, not partway up (top ${s.top.toFixed(1)} of ${s.h})`);
      must(!/transform/.test(s.style), `${where}: no transform on the bar at normal scale (${s.style})`);
      must(!s.sideways, `${where}: nothing scrolls sideways`);
      if (s.atEnd) must(s.lastBottom <= s.top + 1, `${where}: the page's last line ends above the bar (${s.lastBottom.toFixed(1)} vs ${s.top.toFixed(1)})`);
      must(s.below <= 1 || !s.atEnd, `${where}: nothing of the page below the window at the end`);
    };
    const toEnd = () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const toTop = () => page.evaluate(() => window.scrollTo(0, 0));
    const cdp = await ctx.newCDPSession(page);

    for (const [name, url, ready] of [
      ["the inbox", "/coach/inbox", `[data-testid="handoff-message"]:has-text("${title}")`],
      ["Today", "/today", '[data-testid="bottom-nav"]'],
      ["DMs", "/conversations", '[data-testid="bottom-nav"]'],
    ] as const) {
      await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
      await page.locator(ready).first().waitFor({ timeout: 20000 });
      await check(`${name}, opened`);
      await toEnd();
      await check(`${name}, scrolled to the end`);
      if (name === "the inbox") {
        const tall = await page.evaluate(() => document.documentElement.scrollHeight);
        must(tall > 844 * 2, `the long message runs past two screens (${tall} px)`);
      }
      // Safari's toolbar collapses (a taller window) and returns (a shorter one) while scrolled.
      await page.setViewportSize({ width: 390, height: 900 });
      await toEnd();
      await check(`${name}, toolbar collapsed`);
      await page.setViewportSize({ width: 390, height: 760 });
      await check(`${name}, toolbar back`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
      // A pinch-zoom in and back out: the bar is pinned while zoomed and let go at once after.
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
      await page.waitForTimeout(300);
      await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
      await check(`${name}, after a zoom in and out`);
      await toTop();
      await check(`${name}, back at the top`);
      if (name === "the inbox") await page.screenshot({ path: "screenshots/tb01-inbox-390.png" });
    }
    must(!failures.length, `server errors: ${failures.join(", ")}`);
    console.log("✓ the tab bar stays at the bottom edge at 390: the inbox's long message, Today and DMs, scrolled to the end and back, the toolbar collapsing and returning, a zoom in and out; the last line clears the bar");
  } finally {
    await db.delete(schema.handoffMessages).where(eq(schema.handoffMessages.id, msgId)).catch((e) => console.error(`the smoke message was not removed: ${String(e)}`));
    await browser.close();
  }
  console.log("Tab bar smoke passed");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
