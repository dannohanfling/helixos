/**
 * A lead colour per pathway (H-811 B1). Maya gets two pathways and a kit of her own. On Settings → Brand kit she sets one
 * pathway's colour: a bad hex and a banned one are refused by name and nothing is saved; a good one is saved, and an empty
 * one clears it. A webinar whose offer sits in that pathway renders its deck with that colour as the accent (the same kit the
 * Deck step and the export read); one with no pathway keeps the kit's own. At 1440 and 390, nothing scrolls sideways.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function submit(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const { deckKitFor } = await import("@/lib/queries/brand-kit");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const O = { workspaceId: mm.workspaceId, userId: maya.id };
  const ids = { business: newId(), orgs: newId(), offerIn: newId(), offerOut: newId() };
  const hadKit = await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, O.workspaceId), eq(schema.brandKits.userId, O.userId)) });
  const kitId = hadKit?.id ?? newId();
  if (!hadKit) await db.insert(schema.brandKits).values({ id: kitId, ...O, name: "Walk kit", ground: "F7F5F0", ink: "1F2A37", accent: "0F766E", muted: "5B6472", surface: "ECE8E1", displayFont: "Montserrat", bodyFont: "Arial", fontFallback: "Arial", bannedColors: ["FF0000"] });
  const kitBefore = hadKit ? { bannedColors: hadKit.bannedColors } : null;
  if (hadKit) await db.update(schema.brandKits).set({ bannedColors: ["FF0000"] }).where(eq(schema.brandKits.id, kitId));
  await db.insert(schema.pathways).values([
    { id: ids.business, ...O, name: "Walk Business", order: 98 },
    { id: ids.orgs, ...O, name: "Walk Organisations", order: 99 },
  ]);
  await db.insert(schema.offers).values([
    { id: ids.offerIn, ...O, name: "Walk pathway offer", price: 997, pathwayId: ids.business },
    { id: ids.offerOut, ...O, name: "Walk loose offer", price: 497 },
  ]);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings#brand-kit`);
    const field = (name: string) => page.locator(`[data-testid="brand-pathway-colour"][data-pathway="${name}"]`);
    await field("Walk Business").waitFor({ timeout: 20000 });
    must((await field("Walk Organisations").count()) === 1, "each of Maya's pathways has its colour field");

    await field("Walk Business").fill("orange");
    await submit(page, '[data-testid="brand-pathways-save"]');
    must((await page.locator('[data-testid="brand-refused"]').innerText()).includes("Walk Business: orange isn't a six-digit hex colour"), "a bad colour is refused by name");
    await page.goto(`${base}/settings#brand-kit`);
    await field("Walk Business").fill("#ff0000");
    await submit(page, '[data-testid="brand-pathways-save"]');
    must((await page.locator('[data-testid="brand-refused"]').innerText()).includes("one of your brand's banned colours"), "a banned colour is refused by name");
    let p = (await db.query.pathways.findFirst({ where: eq(schema.pathways.id, ids.business) }))!;
    must(p.leadColor === null, "and nothing is saved");

    await page.goto(`${base}/settings#brand-kit`);
    await field("Walk Business").fill("#c05a2b");
    await submit(page, '[data-testid="brand-pathways-save"]');
    must(await page.locator('[data-testid="brand-pathways-saved"]').isVisible(), "a good colour is saved");
    p = (await db.query.pathways.findFirst({ where: eq(schema.pathways.id, ids.business) }))!;
    must(p.leadColor === "C05A2B", `saved as six-digit hex: ${p.leadColor}`);
    must((await field("Walk Business").inputValue()) === "C05A2B", "and shown back");

    const kit = (await db.query.brandKits.findFirst({ where: eq(schema.brandKits.id, kitId) }))!;
    const inPathway = await deckKitFor({ ...O, offerId: ids.offerIn }, kit);
    const loose = await deckKitFor({ ...O, offerId: ids.offerOut }, kit);
    must(inPathway?.accent === "C05A2B" && inPathway.name === kit.name, `a webinar on the pathway's offer renders with its colour as the accent: ${inPathway?.accent}`);
    must(loose?.accent === kit.accent, "an offer with no pathway keeps the kit's own accent");
    must((await deckKitFor({ ...O, offerId: null }, kit))?.accent === kit.accent, "and so does a webinar with no offer");

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/settings#brand-kit`);
      await field("Walk Business").waitFor();
      must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `the pathway colours fit at ${width}`);
    }
    await field("Walk Business").fill("");
    await submit(page, '[data-testid="brand-pathways-save"]');
    p = (await db.query.pathways.findFirst({ where: eq(schema.pathways.id, ids.business) }))!;
    must(p.leadColor === null, "an empty colour clears it, back to the kit's accent");
    console.log("✓ pathway colours: bad and banned refused by name, a good one saved and shown back, empty clears it; the pathway's deck takes it as its accent, others keep the kit's; fits 390 and 1440");
  } finally {
    await browser.close();
    await db.delete(schema.offers).where(inArray(schema.offers.id, [ids.offerIn, ids.offerOut]));
    await db.delete(schema.pathways).where(inArray(schema.pathways.id, [ids.business, ids.orgs]));
    if (!hadKit) await db.delete(schema.brandKits).where(eq(schema.brandKits.id, kitId));
    else if (kitBefore) await db.update(schema.brandKits).set(kitBefore).where(eq(schema.brandKits.id, kitId));
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Pathway colour smoke passed");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
