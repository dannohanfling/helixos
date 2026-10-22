/**
 * Funnel 1 walk (H-674, plan H-721, Danno's answers H-841): the public HelixOS sales page at /start.
 *
 *  1. /start opens with no session (no redirect to the login), indexable, with its title, description and Open Graph image.
 *  2. One call to action: every Start with me button goes to the existing checkout, the nav one jumps to the Start section;
 *     no "Book a call" and no call page.
 *  3. No price or currency sign anywhere in the page's text; the only audience figure is the approved line.
 *  3b. The proof strip (approved quotes, no figures, still with reduced motion) and the reading bar (H-1725).
 *  4. Every picture loads; the Open Graph image is a 1200x630 JPEG.
 *  5. At 1440, 390 and 360: nothing wider than the screen, every control 44px tall or more.
 *  6. No Meta Pixel beacon without FUNNEL_PIXEL_ID (the walk's server has none); no other tracker on the page.
 *  7. robots.txt allows /start and still disallows the app; the footer's Privacy, Terms and Support pages open.
 *
 * `npx tsx scripts/smoke-funnel1.ts http://localhost:3000`
 */
import { chromium, type Page } from "@playwright/test";
import { PROOF } from "@/lib/hermes/funnel";
import { hasNumbers } from "@/lib/hermes/rules";

const base = process.argv[2] ?? "http://localhost:3000";
const CHECKOUT = "https://evolveomega.com/partner";
const must = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};

async function sizes(page: Page, width: number) {
  await page.setViewportSize({ width, height: width > 800 ? 900 : 844 });
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const root = document.querySelector(".fn-root");
    const small: string[] = [];
    let controls = 0;
    for (const el of Array.from(root?.querySelectorAll("a, button, summary") ?? [])) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(el).visibility === "hidden") continue;
      controls++;
      if (b.height < 44) small.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(b.height)}px`);
    }
    return { scroll: document.documentElement.scrollWidth, inner: window.innerWidth, controls, small };
  });
}

async function main() {
  // 1. Open with no session.
  const res = await fetch(`${base}/start`, { redirect: "manual" });
  must(res.status === 200, `/start answers 200 with no session (got ${res.status} ${res.headers.get("location") ?? ""})`);
  const html = await res.text();
  must(!/noindex/i.test(html), "/start is indexable");
  must(html.includes("<title>HelixOS: your whole business, in your pocket.</title>"), "the page title");
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  must(og && /^https?:\/\//.test(og) && og.includes("/start/opengraph-image"), `an absolute Open Graph image: ${og}`);
  must(/<meta property="og:title" content="HelixOS: your whole business, in your pocket."/.test(html), "the Open Graph title");
  const ogPath = new URL(og!).pathname + new URL(og!).search;
  const ogRes = await fetch(`${base}${ogPath}`);
  const ogBytes = Buffer.from(await ogRes.arrayBuffer());
  must(ogRes.status === 200 && (ogRes.headers.get("content-type") ?? "").startsWith("image/jpeg"), "the Open Graph image is served as a JPEG with no session");
  // JPEG SOF0/SOF2 marker carries the size: 1200 x 630.
  const sof = ogBytes.findIndex((b, i) => b === 0xff && (ogBytes[i + 1] === 0xc0 || ogBytes[i + 1] === 0xc2));
  must(sof > 0 && ogBytes.readUInt16BE(sof + 7) === 1200 && ogBytes.readUInt16BE(sof + 5) === 630, "the Open Graph image is 1200x630");
  console.log("✓ /start opens with no session: indexable, its title, and a 1200x630 Open Graph image");

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const failures: string[] = [];
    const thirdParty = new Set<string>();
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== new URL(base).origin) thirdParty.add(u.host);
    });
    await page.goto(`${base}/start`);
    await page.locator('[data-testid="fn-root"]').waitFor({ timeout: 60000 });
    must(page.url() === `${base}/start`, `no redirect: ${page.url()}`);

    // 2. One call to action.
    const starts = page.locator('a:has-text("Start with me")');
    const n = await starts.count();
    must(n === 4, `four Start with me buttons (nav, hero, the Start box, the close): ${n}`);
    for (let i = 0; i < n; i++) {
      const href = await starts.nth(i).getAttribute("href");
      must(href === CHECKOUT || href === "#start", `Start with me goes to the checkout or the Start section: ${href}`);
    }
    must((await page.locator(`a[href="${CHECKOUT}"]`).count()) === 3, "three buttons open the checkout");
    must((await page.locator('[data-testid="fn-nav-start"]').getAttribute("href")) === "#start", "the nav button jumps to the Start section");
    const text = await page.locator('[data-testid="fn-root"]').innerText();
    must(!/book a|15-minute call|calendar/i.test(text), "no call to book, no calendar");
    must((await fetch(`${base}/start/call`, { redirect: "manual" })).status === 404, "no call page");
    console.log("✓ one call to action: three buttons to the checkout and the nav to the Start section; no call page");

    // 3. No price.
    must(!/[$€£]|per month|\/\s?mo\b/i.test(text), "no price or currency sign on the page");
    must(text.includes("About 101,000 people follow along across my two communities."), "the approved audience line");
    for (const section of ["fn-feature-today", "fn-feature-aqueduct", "fn-feature-board", "fn-feature-colosseum", "fn-chamber", "fn-letter", "fn-start"]) {
      must(await page.locator(`[data-testid="${section}"]`).count(), `the ${section} section`);
    }
    console.log("✓ no price anywhere; the approved audience line; every section from the mockup");

    // 3b. The proof strip and the reading bar (H-1725): approved quotes only, none with a figure, a loop that stops for
    // reduced motion; the bar fills as the page scrolls.
    const quotes = await page.locator('[data-testid="fn-proof"] ul:not([aria-hidden]) .fn-proof-quote').allInnerTexts();
    must(quotes.length === PROOF.length, `the strip shows each approved quote once (${quotes.length})`);
    for (const q of quotes) must(!hasNumbers(q), `no figure in a quote on the page: ${q.slice(0, 40)}`);
    must((await page.locator('[data-testid="fn-proof"] ul[aria-hidden="true"]').count()) === 1, "the loop's copy is hidden from screen readers");
    const anim = await page.locator(".fn-proof-track").evaluate((e) => getComputedStyle(e).animationName);
    must(anim === "fn-proof", `the strip drifts (${anim})`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(200);
    const bar = await page.locator('[data-testid="fn-progress"]').evaluate((e) => getComputedStyle(e).transform);
    must(/^matrix\(0\.[1-9]/.test(bar), `the reading bar fills as the page scrolls (${bar})`);
    await page.evaluate(() => window.scrollTo(0, 0));
    const still = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    await still.goto(`${base}/start`);
    must((await still.locator(".fn-proof-track").evaluate((e) => getComputedStyle(e).animationName)) === "none", "reduced motion stops the strip");
    must((await still.locator('[data-testid="fn-proof"] ul[aria-hidden="true"]').evaluate((e) => getComputedStyle(e).display)) === "none", "reduced motion shows one copy");
    await still.close();
    console.log(`✓ the proof strip: ${quotes.length} approved quotes, no figures, still with reduced motion; the reading bar fills on scroll`);

    // 4. Pictures.
    await page.evaluate(async () => {
      for (const img of Array.from(document.images)) img.loading = "eager";
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      window.scrollTo(0, 0);
    });
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 30000 });
    const broken = await page.evaluate(() => Array.from(document.images).filter((i) => !i.naturalWidth && !i.closest(".fn-pixel")).map((i) => i.alt || i.src));
    const count = await page.evaluate(() => document.images.length);
    must(count >= 8 && !broken.length, `every picture loads (${count}): ${broken.join(", ")}`);
    console.log(`✓ all ${count} pictures load`);

    // 5. Sizes.
    for (const width of [1440, 390, 360]) {
      const r = await sizes(page, width);
      must(r.scroll <= r.inner, `nothing wider than the screen at ${width}px (${r.scroll} > ${r.inner})`);
      must(r.controls > 0 && !r.small.length, `every control 44px or taller at ${width}px: ${r.small.join("; ")}`);
    }
    console.log("✓ 1440, 390 and 360: no sideways scroll, every control 44px or taller");

    // 6. No pixel, no tracker.
    must(!(await page.locator('[data-testid^="hm-pixel"]').count()), "no Pixel beacon without FUNNEL_PIXEL_ID");
    must(![...thirdParty].length, `no request leaves HelixOS: ${[...thirdParty].join(", ")}`);
    must(!failures.length, `no failed responses: ${failures.join(", ")}`);
    console.log("✓ no Pixel beacon without FUNNEL_PIXEL_ID, and no request to any other site");

    // 7. robots.txt and the footer pages.
    const robots = await (await fetch(`${base}/robots.txt`)).text();
    must(/Allow: \/start\b/.test(robots) && /Disallow: \/\s*$/m.test(robots), `robots.txt allows /start and still disallows the app: ${robots}`);
    for (const href of ["/privacy", "/terms", "/support"]) {
      must((await page.locator(`.fn-footer a[href="${href}"]`).count()) === 1, `the footer links ${href}`);
      must((await fetch(`${base}${href}`, { redirect: "manual" })).status === 200, `${href} opens with no session`);
    }
    console.log("✓ robots.txt allows /start; Privacy, Terms and Support open from the footer");
  } finally {
    await browser.close();
  }
  console.log("funnel1 walk: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
