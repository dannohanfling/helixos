/**
 * A new client's first deck (first-deck brief §2, 5 Oct): a webinar with no proof and no stories, every one of its 20 sections
 * drafted with ✨, exports with slides in every act. The draft writes the deck lines with the script; a line quoting a figure
 * the record never gave is dropped; the proof slide keeps [PROOF PLACEHOLDER]; the closing frame's draft names the linked
 * offer's own price; "2 a.m." stays "2 a.m."; an answer cut off at the output budget is never saved; a section with a script
 * and no key points is named on the Deck step and gets its slides from "Make slides from my script"; the Key points box
 * carries no other coach's example. Runs against scripts/mock-ai.ts (the dev server must have AI_BASE_URL=http://localhost:4020).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function main() {
  const ai = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { SECTION_TEMPLATES } = await import("@/lib/engine/webinar");
    const { contextFor } = await import("@/lib/queries/webinar");
    const { deckSlides } = await import("@/lib/engine/deck");
    const { slideCountFor } = await import("@/lib/engine/section-draft");

    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');

    // ── A brand-new webinar, as a day-one client starts one: a title and a promise, no proof, no stories. ──
    await page.goto(`${base}/webinars`);
    await page.locator('summary:has-text("New webinar")').first().click();
    await page.fill('form input[name="title"]', "Walk: Sleep Through the Night");
    await page.fill('form input[name="promise"]', "Sleep through the night in 30 days");
    await Promise.all([page.waitForURL(/\/webinars\/[^/?]+\?step=foundation/), page.locator('form:has(input[name="title"]) button[type="submit"]').first().click()]);
    const webinarId = page.url().split("/webinars/")[1].split("?")[0];
    const w = () => db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId) }).then((x) => x!);
    // The closing frame presents an offer: link the client's own (arranged here; the Offer step's own walk covers the picker).
    const offer = (await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, user.id), eq(schema.offers.status, "live")) }))!;
    await db.update(schema.webinars).set({ offerId: offer.id }).where(eq(schema.webinars.id, webinarId));
    const sections = () => db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, webinarId) });
    must((await sections()).length === SECTION_TEMPLATES.length, "the new webinar has every section of the template");

    // ── The Key points box carries no other coach's example. ──
    const first = SECTION_TEMPLATES[0];
    await page.goto(`${base}/webinars/${webinarId}?step=script&section=${first.key}`);
    const ph = (await page.locator('[data-testid="section-key-points"]').getAttribute("placeholder")) ?? "";
    must(!/webinars stall|Synchronized Journey|Leaky/i.test(ph) && ph.includes("one slide"), `the Key points placeholder is neutral: "${ph}"`);

    // ── An answer cut off at the budget is never saved: the page says so and the section stays empty. ──
    await db.update(schema.webinarSections).set({ keyPoints: "• MOCK-CUT this one" }).where(and(eq(schema.webinarSections.webinarId, webinarId), eq(schema.webinarSections.sectionKey, first.key)));
    await page.goto(`${base}/webinars/${webinarId}?step=script&section=${first.key}`);
    await submit(page, 'button:has-text("Draft this section for me")');
    await page.locator('[data-testid="draft-error"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="draft-error"]').innerText()).includes("cut off"), "a cut-off draft says so");
    const afterCut = (await sections()).find((s) => s.sectionKey === first.key)!;
    must(!afterCut.script && afterCut.status === "todo", "and nothing of it was saved");
    await db.update(schema.webinarSections).set({ keyPoints: null }).where(eq(schema.webinarSections.id, afterCut.id));
    console.log("✓ a neutral Key points placeholder; a draft cut off at the budget is refused in plain words and nothing is saved");

    // ── ✨ on all 20 sections, the way a non-technical client would. ──
    for (const t of SECTION_TEMPLATES) {
      await page.goto(`${base}/webinars/${webinarId}?step=script&section=${t.key}`);
      await submit(page, 'button:has-text("Draft this section for me")');
    }
    const drafted = await sections();
    const noPoints = drafted.filter((s) => !s.keyPoints?.trim());
    must(noPoints.length === 0, `every drafted section has key points: missing on ${noPoints.map((s) => s.name).join(", ")}`);
    must(drafted.every((s) => s.script?.includes("2 a.m.") && !/\b2 m\./.test(s.script ?? "")), '"2 a.m." stays "2 a.m." in every script');
    const lines = drafted.flatMap((s) => (s.keyPoints ?? "").split("\n"));
    must(!lines.some((l) => l.includes("47%")), "a deck line with a figure the record never gave is dropped");
    must(lines.some((l) => l.includes("[PROOF PLACEHOLDER]")), "the proof placeholder is kept as its own line");
    for (const s of drafted) must((s.keyPoints ?? "").split("\n").length <= slideCountFor(s.durationMin) + 2, `${s.name}: about one line per two minutes`);
    const price = `$${offer.price.toLocaleString("en-US")}`;
    const stack = drafted.find((s) => s.act === "closing" && /offer stack/i.test(s.name))!;
    must(stack.script?.includes(price) && (stack.keyPoints ?? "").includes(price), `the closing frame's draft names the linked offer's own price, ${price}, in the script and on a slide`);
    console.log(`✓ ${drafted.length} sections drafted with ✨: each has its slides; a made-up figure dropped; the proof placeholder kept; "2 a.m." intact; the offer stack names ${price}`);

    // ── The export has slides in every act, and none of them invents a result. ──
    const deck = deckSlides(await contextFor(await w()), null);
    for (const act of ["opening", "vehicle", "internal", "external", "closing"]) {
      const n = deck.slides.filter((s) => s.act === act && s.kind !== "divider").length;
      must(n > 0, `the deck has slides in the ${act} act (${n})`);
    }
    must(!deck.slides.some((s) => [s.headline, ...s.body].join(" ").includes("47%")), "no slide carries the made-up figure");
    await page.goto(`${base}/webinars/${webinarId}?step=deck`);
    await page.locator('[data-testid="deck-pace"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="deck-partial"]').count()) && !(await page.locator('[data-testid="deck-script-only"]').count()), "the Deck step says nothing is missing");
    console.log(`✓ the export: ${deck.slides.length} slides with teaching in every act and no made-up figure; the Deck step names nothing missing`);

    // ── A section with a script and no key points is named on the Deck step, and Make slides gives it its lines. ──
    const bare = drafted.find((s) => s.act === "vehicle")!;
    await db.update(schema.webinarSections).set({ keyPoints: null }).where(eq(schema.webinarSections.id, bare.id));
    await page.goto(`${base}/webinars/${webinarId}?step=deck`);
    await page.locator('[data-testid="deck-script-only"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="deck-script-only-link"]').allInnerTexts()).map((x) => x.trim()).join("|") === bare.name, "the Deck step names the section with a script and no slides");
    await page.locator('[data-testid="deck-script-only-link"]').click();
    await page.waitForURL(new RegExp(`section=${bare.sectionKey}`));
    await page.locator('[data-testid="needs-slides"]').waitFor({ timeout: 20000 });
    await submit(page, '[data-testid="make-slides"]');
    await page.locator('[data-testid="slides-made"]').waitFor({ timeout: 20000 });
    const made = (await sections()).find((s) => s.id === bare.id)!;
    const madeLines = (made.keyPoints ?? "").split("\n");
    must(madeLines.length === 2 && !madeLines.some((l) => l.includes("99%")) && made.script === bare.script, `Make slides wrote its lines from the script, the made-up figure dropped, the script untouched: ${madeLines.join(" | ")}`);
    must(!(await page.locator('[data-testid="make-slides"]').count()), "with key points, Make slides is no longer offered");
    console.log("✓ a section with a script and no slides is named on the Deck step; Make slides from my script gives it two lines, the made-up figure dropped");

    console.log("\nsmoke-firstdeck: all checks passed");
  } finally {
    await browser.close();
    try {
      process.kill(-ai.pid!);
    } catch {
      /* already gone */
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
