/** Comment ladders: facts profile → new skeleton (no Claude) → checklist blocks it → the finished demo ladder clears → live hour → Airtable copy → composer → scheduled posts keep their text until the client pushes the update. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
// The private store is the mock blob (as the deck-images walk runs it): the walk writes Maya's photo there and reads the graphic back.
const blobPort = 4050;
// Ship (rev 583 #1): the mock Social Planner the app is pointed at through the workspace's integration, and the mock uChat
// the dev server already reads at :4060; the drip webhook lands on the mock planner's inbound hook, as the ghl walk has it.
const ghlPort = 4010;
const uchatPort = 4060;
const DRIP_HOOK = `http://localhost:${ghlPort}/api/iwh/abcdef0123456789abcdef0123456789`;
// Ship's rungs-only webhook (rev 625), separate from the old publisher one, which Ship never calls.
const RUNGS_HOOK = `http://localhost:${ghlPort}/api/iwh/ru0123456789abcdef0123456789abcd`;
const CL_TOKEN = "uchat-test-token-for-maya-ship-0123456789";
process.env.PROOF_BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_PROOFSTORE_testsecret";
process.env.BLOB_READ_WRITE_TOKEN ||= "vercel_blob_rw_TESTSTORE_testsecret";
process.env.VERCEL_BLOB_API_URL ||= `http://localhost:${blobPort}`;
// The walk seals Maya's Planner token as the dev server does, so the server can open it (scripts/dev-server.sh's secret).
process.env.SESSION_SECRET ||= "dev-secret-dev-secret-dev-secret-123";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // A page answers at once with its loading skeleton; it must clear within 3 seconds, then the text must be there.
  await page.locator('[data-testid="page-loading"]').waitFor({ state: "hidden", timeout: 3000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-stuck-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] loading skeleton still showing after 3s on ${page.url()}: a client would see no page`);
  });
  await page.getByText(re).filter({ visible: true }).first().waitFor({ timeout: 15000 }).catch(async () => {
    await page.screenshot({ path: `screenshots/fail-${label.replace(/\W+/g, "-")}.png`, fullPage: true });
    throw new Error(`[${label}] expected "${text}" on ${page.url()}`);
  });
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function checks(page: Page): Promise<Record<string, boolean>> {
  const items = await page.locator('[data-testid="checklist"] li').evaluateAll((els) => els.map((e) => [e.getAttribute("data-check"), e.getAttribute("data-ok") === "1"]));
  return Object.fromEntries(items as [string, boolean][]);
}
/** A fill right after navigation can land mid-hydration and merge with the old value; write until the field holds exactly this. */
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector} to the expected text`);
}
/** After a save the page re-renders from the server; wait (bounded) for the checklist to show the expected state. */
async function checksWhen(page: Page, key: string, expected: boolean): Promise<Record<string, boolean>> {
  const started = Date.now();
  let c = await checks(page);
  while (c[key] !== expected && Date.now() - started < 10000) {
    await page.waitForTimeout(250);
    c = await checks(page);
  }
  return c;
}

async function main() {
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true });
  const ghl = spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(ghlPort)], { stdio: "ignore", detached: true });
  const uchat = spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(uchatPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 3000));
  await fetch(`http://localhost:${ghlPort}/__reset`, { method: "POST", headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } }).catch(() => null);
  await fetch(`http://localhost:${uchatPort}/__reset`, { method: "POST" }).catch(() => null);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // Facts profile (seeded for Maya): open, tweak, save
    await page.goto(`${base}/content/ladders/profile`);
    await expectText(page, "Your ladder facts", "profile page");
    if ((await page.inputValue('input[name="productName"]')) !== "The 90-Day Reset") throw new Error("seeded profile not loaded");
    // Keywords know what they fetch (L1, rev 562): the seeded rows carry their targets; a third keyword is added with none.
    if ((await page.locator('[data-testid="kw-0-target"]').inputValue()) !== "product" || (await page.locator('[data-testid="kw-1-target"]').inputValue()) !== "conversation" || !(await page.locator('[data-testid="kw-1-line"]').inputValue()).includes("free 7-day starter plan")) throw new Error("the seeded keywords show their targets: RESET the product, PLAN a conversation with its line");
    await page.fill('[data-testid="kw-2-keyword"]', "lost");
    await page.fill('textarea[name="bannedPhrases"]', "cheat day\nguilt-free\nskinny\nmagic pill");
    await submit(page, 'button:has-text("Save facts")');
    await page.waitForURL(/\/content\/ladders$/);
    {
      const { db: dbp, schema: sp } = await import("@/db");
      const { eq: eqp } = await import("drizzle-orm");
      const saved = (await dbp.query.ladderProfiles.findMany({ where: eqp(sp.ladderProfiles.productName, "The 90-Day Reset") }))[0];
      if (saved.keywords.length !== 3 || saved.keywords[2].keyword !== "LOST" || saved.keywords[2].target || saved.keywords[0].target?.kind !== "product" || saved.keywords[1].target?.kind !== "conversation" || saved.keywords[1].kind !== "both") throw new Error(`the rows save their targets: ${JSON.stringify(saved.keywords)}`);
      const option = await page.locator('select[name="keyword"] option[value="PLAN"]').innerText();
      if (!option.includes("fetches a conversation")) throw new Error(`the keyword picker says what each fetches: ${option}`);
    }
    console.log("✓ facts profile saved, keywords with their targets (and LOST with none)");

    // New ladder without Claude → skeleton, checklist blocks it
    await expectText(page, "Build the skeleton", "no-AI button");
    await page.selectOption('select[name="format"]', "loss_rebuild");
    await page.fill('input[name="topic"]', "If I lost every client tomorrow");
    await page.selectOption('select[name="keyword"]', "RESET");
    await submit(page, 'button:has-text("Build the skeleton")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i);
    await expectText(page, "skeleton, fill the blanks", "generated by scaffold");
    let c = await checks(page);
    if (c.placeholders !== false) throw new Error("skeleton should fail the placeholder check");
    if (c.cta !== true) throw new Error("skeleton CTA rung should already carry the keyword and fallback");
    if (!(await page.locator('button:has-text("Mark ready")').isDisabled())) throw new Error("Mark ready must be disabled while the checklist fails");
    // The gate is the server, not the button: force the submit past the disabled control and the action must refuse
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const ladderId = page.url().split("/").pop()!.split("?")[0];
    const notice = page.locator('[data-testid="publish-blocked"]');
    if (!(await notice.count())) throw new Error("no notice names the failing checks");
    const links = await notice.locator('[data-testid="blocker-link"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    if (!links.length || !links.every((h) => h?.startsWith("#check-"))) throw new Error(`blockers should link to their checks: ${links.join(", ")}`);
    for (const href of links) if (!(await page.locator(href!).count())) throw new Error(`blocker link ${href} has no target`);
    if (!(await page.locator('[data-testid="send-to-composer"]').isDisabled())) throw new Error("Send to composer must be held while the checklist fails");
    await page.locator('[data-testid="send-to-composer"]').evaluate((el) => el.removeAttribute("disabled"));
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('[data-testid="send-to-composer"]').click()]);
    await page.waitForURL(/blocked=/, { timeout: 10000 });
    let row = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) });
    if (row?.contentItemId) throw new Error("a failing ladder was still sent to the composer");
    await expectText(page, "That didn't go out", "refusal named");
    const firstRung = page.locator('[data-testid="mark-rung"]').first();
    await firstRung.evaluate((el) => el.removeAttribute("disabled"));
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), firstRung.click()]);
    await page.waitForTimeout(600);
    row = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) });
    if (!row?.rungs.length) throw new Error("the ladder has rungs to mark");
    if (row.rungs.some((r) => r.postedAt)) throw new Error("a rung of a failing ladder was marked posted");
    if (!(await page.locator('button:has-text("Copy for Airtable")').isDisabled())) throw new Error("copies must be held while the checklist fails");
    console.log("✓ publish gate: server refuses the composer send and a posted rung while checks fail; blockers named and linked; copies held");
    await page.goto(`${base}/content/ladders/${ladderId}`);
    // Edit the body to add comment bait and confirm it's caught after save
    await fillExact(page, 'textarea[name="copy"]', "If I lost every client tomorrow.\nComment RESET for the plan.");
    await submit(page, 'button:has-text("Save and re-check")');
    c = await checksWhen(page, "bait", false);
    if (c.bait !== false || c.question !== false) throw new Error("comment bait / missing question not caught");
    await page.screenshot({ path: "screenshots/ld01-skeleton-checklist.png", fullPage: true });
    console.log("✓ skeleton built; checklist blocks placeholders, comment bait and a missing question");

    // ── Keywords know what they fetch (L1): a conversation keyword's final rung carries the line and no price; a keyword with no
    // target cannot go ready; the product pitched under a conversation keyword fails the checklist. ──
    const skeletonWith = async (keyword: string, topic: string) => {
      await page.goto(`${base}/content/ladders`);
      await page.selectOption('select[name="format"]', "method_resource");
      await page.fill('input[name="topic"]', topic);
      await page.selectOption('select[name="keyword"]', keyword);
      await submit(page, 'button:has-text("Build the skeleton")');
      await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i);
      return page.url().split("/").pop()!.split("?")[0];
    };
    const planId = await skeletonWith("PLAN", "The starter plan, in five moves");
    const planRow = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, planId) }))!;
    const planFinal = planRow.rungs[planRow.rungs.length - 1].body;
    if (!planFinal.includes("free 7-day starter plan") || !planFinal.includes("Comment PLAN and I'll message you.") || planFinal.includes("$497") || planFinal.includes("90-Day Reset")) throw new Error(`a conversation keyword's final rung carries the line and no price: ${planFinal}`);
    if (!(await page.locator('[data-testid="ladder-keyword-target"]').innerText()).includes("fetches a conversation")) throw new Error("the ladder page says what its keyword fetches");
    c = await checks(page);
    if (c["keyword-target"] !== true || c["target-pitch"] !== true) throw new Error(`PLAN has a target and pitches nothing: ${JSON.stringify(c)}`);
    // The product written into the final rung under a conversation keyword: the checklist fails it by name.
    const rungsText = await page.locator('textarea[name="rungs"]').inputValue();
    await fillExact(page, 'textarea[name="rungs"]', rungsText.replace("Comment PLAN and I'll message you.", "Join The 90-Day Reset for $497 for 90 days.\nComment PLAN and I'll message you."));
    await submit(page, 'button:has-text("Save and re-check")');
    c = await checksWhen(page, "target-pitch", false);
    if (c["target-pitch"] !== false) throw new Error("the product pitched under a conversation keyword fails the checklist");
    const pitchNote = await page.locator('[data-testid="checklist"] li[data-check="target-pitch"]').innerText();
    if (!pitchNote.includes("The 90-Day Reset") || !pitchNote.includes("$497")) throw new Error(`the fail names what was pitched: ${pitchNote}`);
    await fillExact(page, 'textarea[name="rungs"]', rungsText);
    await submit(page, 'button:has-text("Save and re-check")');
    c = await checksWhen(page, "target-pitch", true);
    const lostId = await skeletonWith("LOST", "A keyword with no target");
    c = await checks(page);
    if (c["keyword-target"] !== false) throw new Error("a keyword with no target fails the checklist");
    if (!(await page.locator('[data-testid="checklist"] li[data-check="keyword-target"]').innerText()).includes("Give LOST a target")) throw new Error("the fail says where to give it one");
    const lostRow = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, lostId) }))!;
    if (!lostRow.rungs[lostRow.rungs.length - 1].body.includes("[GIVE LOST A TARGET ON YOUR LADDER FACTS]")) throw new Error("the skeleton's final rung asks for the target");
    console.log("✓ keywords know what they fetch: PLAN's final rung carries its line and no price; the product pitched under it fails by name; LOST, with no target, cannot go ready");


    // The finished demo ladder clears the checklist
    await page.goto(`${base}/content/ladders`);
    await page.click('a:has-text("SKIN — Mistakes Ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i);
    c = await checks(page);
    const failing = Object.entries(c).filter(([, ok]) => !ok).map(([k]) => k);
    if (failing.length) throw new Error(`demo ladder should clear the checklist, failing: ${failing.join(", ")}`);
    await expectText(page, "checklist", "checklist card");
    if (!(await page.locator('[data-testid="headline-preview"]').isVisible())) throw new Error("headline preview missing");
    console.log("✓ finished ladder clears every check");
    // A ready ladder edited into a failing state is a draft again; fixed, it can be marked ready
    const demoId = page.url().split("/").pop()!.split("?")[0];
    const cleanCopy = await page.locator('textarea[name="copy"]').inputValue();
    await fillExact(page, 'textarea[name="copy"]', `${cleanCopy}\nThe skinny version is in the comments?`);
    await submit(page, 'button:has-text("Save and re-check")');
    let demo = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) });
    if (demo?.status !== "draft") throw new Error(`a ready ladder edited to fail should be a draft again, is ${demo?.status}`);
    if (!(await page.locator('[data-testid="publish-blocked"]').count())) throw new Error("failing edit shows no blockers");
    await fillExact(page, 'textarea[name="copy"]', cleanCopy);
    await submit(page, 'button:has-text("Save and re-check")');
    await submit(page, 'button:has-text("Mark ready")');
    demo = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) });
    if (demo?.status !== "ready") throw new Error(`fixed ladder should be ready, is ${demo?.status}`);
    console.log("✓ a failing edit demotes ready to draft; fixed, it is ready again");

    // Live hour: post rung 1, rung 2; status goes live; reset returns to ready
    await submit(page, '[data-testid="rung-1"] button:has-text("Posted")');
    await expectText(page, "1/11 posted", "first rung posted");
    await expectText(page, "live", "status live");
    await submit(page, '[data-testid="rung-2"] button:has-text("Posted")');
    await expectText(page, "2/11 posted", "second rung posted");
    // While a live ladder fails: Undo works, posting another rung is refused, Reset lands on draft, not ready
    await fillExact(page, 'textarea[name="copy"]', `${cleanCopy}\nThe skinny version is in the comments?`);
    await submit(page, 'button:has-text("Save and re-check")');
    const rungButtons = page.locator('[data-testid="mark-rung"]');
    await submit(page, '[data-testid="mark-rung"] >> nth=1');
    await expectText(page, "1/11 posted", "undo allowed while blocked");
    await rungButtons.nth(2).evaluate((el) => el.removeAttribute("disabled"));
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), rungButtons.nth(2).click()]);
    await page.waitForURL(/blocked=/, { timeout: 10000 });
    demo = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) });
    if (demo?.rungs.filter((r) => r.postedAt).length !== 1) throw new Error("posting a rung of a failing live ladder was not refused");
    await submit(page, 'button:has-text("Reset")');
    demo = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) });
    if (!demo?.rungs.length) throw new Error("the demo ladder has rungs");
    if (demo.status !== "draft" || demo.rungs.some((r) => r.postedAt)) throw new Error(`Reset on a failing ladder should land on draft with no rungs posted, got ${demo?.status}`);
    await fillExact(page, 'textarea[name="copy"]', cleanCopy);
    await submit(page, 'button:has-text("Save and re-check")');
    await submit(page, 'button:has-text("Mark ready")');
    console.log("✓ while blocked: undo allowed, posting refused, Reset lands on draft; fixed and ready again");
    await page.screenshot({ path: "screenshots/ld02-live-hour.png", fullPage: true });
    await submit(page, 'button:has-text("Reset")');
    await expectText(page, "0/11 posted", "reset");
    console.log("✓ live posting hour ticks rungs and resets");

    // Airtable copy escapes the numbering
    await page.click('button:has-text("Copy for Airtable")');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    if (!clip.startsWith("1\\. Mistake one.") || !clip.includes("\n---\n2\\. ")) throw new Error(`Airtable copy not escaped: ${clip.slice(0, 40)}`);
    console.log("✓ Airtable copy escapes rung numbers");

    // ── Make the graphic (rev 513, 514, 515, 524): Maya's own photo, the template, one 2× master, the 1080 copy on request, a remake. ──
    const { putDeckObject, readProofObject } = await import("@/lib/proof-storage");
    const { deckImageKey } = await import("@/lib/engine/deck-image");
    const { newId } = await import("@/lib/ids");
    const sharp = (await import("sharp")).default;
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = mayaM.workspaceId;
    const photoBytes = await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 46, g: 134, b: 222 } } }).jpeg().toBuffer();
    const photoId = newId();
    const obj = await putDeckObject(deckImageKey(ws, maya.id, photoId, "jpg"), photoBytes, "image/jpeg");
    await db.insert(schema.deckImages).values({ id: photoId, workspaceId: ws, userId: maya.id, kind: "photo", blobKey: obj.key, blobUrl: obj.url, mime: "image/jpeg", width: 1200, height: 1500, caption: "Me, the week three diet photo" });
    const otherId = newId();
    const obj2 = await putDeckObject(deckImageKey(ws, maya.id, otherId, "jpg"), photoBytes, "image/jpeg");
    await db.insert(schema.deckImages).values({ id: otherId, workspaceId: ws, userId: maya.id, kind: "photo", blobKey: obj2.key, blobUrl: obj2.url, mime: "image/jpeg", width: 1200, height: 1500, caption: "Desk at night" });
    // The badge from the Brand kit (Settings), the avatar one of her own photos; AI backgrounds stay on by default.
    await page.goto(`${base}/settings`);
    // A member with no kit yet saves the starter kit under a name of their own, with the badge on it.
    if (!(await page.locator('[data-testid="brand-form"] input[name="name"]').inputValue()).trim()) await page.fill('[data-testid="brand-form"] input[name="name"]', "Maya's kit");
    await page.fill('[data-testid="brand-graphic-name"]', "Maya Torres");
    await page.fill('[data-testid="brand-graphic-handle"]', "mayacoaches");
    await page.check('[data-testid="brand-graphic-verified"]');
    await page.selectOption('[data-testid="brand-graphic-avatar"]', photoId);
    if (!(await page.locator('[data-testid="brand-ai-backgrounds"]').isChecked())) throw new Error("Allow AI backgrounds is on by default");
    await submit(page, 'button:has-text("Save brand kit")');
    if (await page.locator('[data-testid="brand-refused"]').count()) throw new Error(`the kit was refused: ${await page.locator('[data-testid="brand-refused"]').innerText()}`);
    await page.locator('[data-testid="brand-saved"]').waitFor({ timeout: 15000 });
    const kit = await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, ws), eq(schema.brandKits.userId, maya.id)) });
    if (kit?.graphicDisplayName !== "Maya Torres" || kit.graphicHandle !== "@mayacoaches" || !kit.graphicVerified || kit.graphicAvatarImageId !== photoId || !kit.aiBackgrounds) throw new Error(`the kit carries the badge: ${JSON.stringify({ name: kit?.graphicDisplayName, handle: kit?.graphicHandle, v: kit?.graphicVerified, a: kit?.graphicAvatarImageId, ai: kit?.aiBackgrounds })}`);
    await page.goto(`${base}/content/ladders/${demoId}`);
    await page.locator('[data-testid="graphic-maker"]').waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="graphic-photo"]').inputValue()) !== photoId) throw new Error("the photo whose caption shares the headline's words is suggested and picked");
    if (!(await page.locator('[data-testid="graphic-photo"] option').first().innerText()).includes("No photo")) throw new Error("a plain ground is offered");
    const headlines = await page.locator('[data-testid="graphic-headline"] option').allInnerTexts();
    if (headlines.length !== 2 || !headlines[1].startsWith("Alternate")) throw new Error(`the headline and its alternate are offered: ${headlines.join(" | ")}`);
    if (!(await page.locator('[data-testid="graphic-none"]').count())) throw new Error("no graphic yet");
    await Promise.all([page.waitForURL(/graphic=made/, { timeout: 60000 }), page.locator('[data-testid="graphic-make"]').click()]);
    await page.locator('[data-testid="graphic-made"]').waitFor({ timeout: 20000 });
    let demoRow = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!;
    const g1 = (await db.query.deckImages.findFirst({ where: eq(schema.deckImages.id, demoRow.graphicImageId ?? "") }))!;
    if (!g1 || g1.kind !== "graphic" || g1.source !== "render" || g1.userId !== maya.id || g1.mime !== "image/png" || g1.width !== 2160 || g1.height !== 2700) throw new Error(`the master is one PNG of kind graphic at 2×: ${JSON.stringify({ kind: g1?.kind, source: g1?.source, mime: g1?.mime, w: g1?.width, h: g1?.height })}`);
    if (g1.caption !== "I QUIT EVERY DIET BY WEEK THREE UNTIL I STOPPED PLANNING SUNDAYS") throw new Error(`the caption is the headline: ${g1.caption}`);
    if (demoRow.graphicOptions?.photoImageId !== photoId || demoRow.graphicOptions.headline !== demoRow.headline) throw new Error(`the options are kept: ${JSON.stringify(demoRow.graphicOptions)}`);
    const masterRes = await readProofObject(g1.blobUrl);
    const master = Buffer.from(await masterRes.arrayBuffer());
    const meta = await sharp(master).metadata();
    if (meta.format !== "png" || meta.width !== 2160 || meta.height !== 2700) throw new Error(`the stored file is a 2160×2700 PNG: ${meta.format} ${meta.width}×${meta.height}`);
    // The photo's blue is in the top; the band under the headline is black.
    const { data: px } = await sharp(master).extract({ left: 1080, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    if (px[2] < 150 || px[0] > 90) throw new Error(`the photo covers the top: ${[...px].join(",")}`);
    const { data: lo } = await sharp(master).extract({ left: 40, top: 2650, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    if (lo[0] > 10 || lo[1] > 10 || lo[2] > 10) throw new Error(`the bottom band is black: ${[...lo].join(",")}`);
    // The gold phrase is drawn in gold, in the headline's own band above "(READ COMMENTS" (9 Oct: it came out missing, or dull).
    const band = await sharp(master).extract({ left: 0, top: 1640, width: 2160, height: 480 }).raw().toBuffer({ resolveWithObject: true });
    let goldPx = 0;
    for (let i = 0; i < band.data.length; i += band.info.channels) { const [r, g, b] = [band.data[i], band.data[i + 1], band.data[i + 2]]; if (r > 190 && g > 130 && g < 200 && b < 110) goldPx++; }
    if (goldPx < 5000) throw new Error(`the headline's gold phrase is drawn in gold: ${goldPx} gold pixels`);
    const small = await page.request.get(`${base}/api/deck-images/${g1.id}?size=1080&download=1`);
    const smeta = await sharp(Buffer.from(await small.body())).metadata();
    if (small.status() !== 200 || smeta.width !== 1080 || smeta.height !== 1350 || smeta.format !== "png" || !(small.headers()["content-disposition"] ?? "").includes("1080x1350")) throw new Error(`the 1080×1350 copy comes on request, as a PNG download: ${small.status()} ${smeta.width}×${smeta.height} ${small.headers()["content-disposition"]}`);
    const graphicsNow = async () => (await db.query.deckImages.findMany({ where: and(eq(schema.deckImages.userId, maya.id), eq(schema.deckImages.kind, "graphic")) })).length;
    const graphicsAfterFirst = await graphicsNow();
    if (graphicsAfterFirst !== 1) throw new Error(`one file is stored, never a second 1080 one (and a skeleton's bracketed headline makes none): ${graphicsAfterFirst}`);
    // Remake with the alternate headline and the other photo: the ladder points at the new one, the old one stays in Images.
    await page.goto(`${base}/content/ladders/${demoId}`);
    await page.locator('[data-testid="graphic-current"]').waitFor({ timeout: 20000 });
    await page.selectOption('[data-testid="graphic-headline"]', { index: 1 });
    await page.selectOption('[data-testid="graphic-photo"]', otherId);
    await page.check('[data-testid="graphic-strong-fade"]');
    await Promise.all([page.waitForURL(/graphic=made/, { timeout: 60000 }), page.locator('[data-testid="graphic-make"]').click()]);
    demoRow = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!;
    if (demoRow.graphicImageId === g1.id || demoRow.graphicOptions?.headline !== demoRow.altHeadlines[0] || demoRow.graphicOptions.photoImageId !== otherId || !demoRow.graphicOptions.strongFade) throw new Error(`the remake replaces the ladder's graphic with the alternate headline: ${JSON.stringify(demoRow.graphicOptions)}`);
    if ((await graphicsNow()) !== graphicsAfterFirst + 1) throw new Error("the previous graphic stays in Images");
    await page.goto(`${base}/images?kind=graphic`);
    await page.locator('[data-testid="library-image-caption"]').first().waitFor({ timeout: 20000 });
    const captions = await page.locator('[data-testid="library-image-caption"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    if (captions.length !== 2 || !captions.some((c) => c.startsWith("FIVE MISTAKES THAT ENDED EVERY DIET"))) throw new Error(`the graphics are in Images under their headlines: ${captions.join(" | ")}`);
    // A gold marker written in place of its words keeps them, in gold, in the page's preview (9 Oct).
    const savedHeadline = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!.headline;
    await db.update(schema.ladders).set({ headline: "HOW TO TURN A FULL ROOM / INTO (gold: BOOKED CALLS)" }).where(eq(schema.ladders.id, demoId));
    await page.goto(`${base}/content/ladders/${demoId}`);
    const previewText = (await page.locator('[data-testid="headline-preview"]').innerText()).replace(/\s+/g, " ");
    if (!previewText.includes("INTO BOOKED CALLS") || (await page.locator('[data-testid="headline-preview-gold"]').innerText()) !== "BOOKED CALLS") throw new Error(`the preview keeps the gold phrase in its line: ${previewText}`);
    await db.update(schema.ladders).set({ headline: savedHeadline }).where(eq(schema.ladders.id, demoId));
    console.log("✓ Make the graphic: the suggested photo, the badge from the kit, one 2× PNG master in Images, the 1080 copy on request, a remake with the alternate headline and a stronger fade; the gold phrase in gold on the master and in its line in the preview");

    // Composer hand-off
    await page.goto(`${base}/content/ladders/${demoId}`);
    const ladderUrl = page.url();
    await submit(page, 'button:has-text("Send to composer")');
    await page.waitForURL(/\/content\/[a-z0-9-]+\/compose/i);
    await expectText(page, "I quit every diet by week three", "body in composer");
    await page.screenshot({ path: "screenshots/ld03-composer.png", fullPage: true });
    // The Threads chain (6–8 posts) stays visible and copyable but is never scheduled as one post: the composer says why, and the rest schedule
    const itemId = page.url().match(/\/content\/([a-z0-9-]+)\/compose/i)![1];
    await expectText(page, "A Threads chain posts as separate posts. Copy them out, or schedule the other channels here.", "chain is copy-only, with the reason");
    if (!(await page.locator('[data-testid="copy-only"] button:has-text("Copy the chain")').count())) throw new Error("the chain must be copyable from the composer");
    if (await page.locator('[data-testid="over-limit"]').count()) throw new Error("a chain must not be shown as one over-long post");
    // The graphic rides in as the post's picture (rev 515); Instagram with no picture is refused before scheduling.
    const chip = page.locator('[data-testid="media-chip"]');
    if (!(await chip.count()) || !(await chip.innerText()).includes("FIVE MISTAKES")) throw new Error(`the ladder's graphic is the post's picture in the composer: ${await chip.count() ? await chip.innerText() : "no chip"}`);
    if (!(await page.locator('[data-testid="media-download"]').getAttribute("href"))?.includes("download=1")) throw new Error("Download image sits beside the picked picture");
    if (await page.locator('[data-testid="instagram-image-block"]').count()) throw new Error("with the graphic picked, Instagram is not blocked");
    await page.locator('[data-testid="media-clear"]').click();
    await page.locator('[data-testid="instagram-image-block"]').waitFor({ timeout: 10000 });
    if (!(await page.locator('[data-testid="instagram-image-block"]').innerText()).includes("Instagram needs an image: Make the graphic or pick one")) throw new Error("the Instagram refusal says what to do");
    if (!(await page.locator('button:has-text("Schedule")').isDisabled())) throw new Error("Schedule is held while Instagram has no picture");
    await page.selectOption('[data-testid="media-from-proof"]', `img:${demoRow.graphicImageId}`);
    await page.locator('[data-testid="instagram-image-block"]').waitFor({ state: "detached", timeout: 10000 });
    await page.click('button:has-text("Schedule")');
    await page.getByText(/Saved \d+ versions/).waitFor({ timeout: 20000 });
    const itemRow = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, itemId) });
    if (itemRow?.mediaAttachmentId !== `img:${demoRow.graphicImageId}`) throw new Error(`the scheduled post carries the graphic: ${itemRow?.mediaAttachmentId}`);
    const fbVariant = () => db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, "fb_personal"), eq(schema.contentVariants.groupId, "")) });
    const scheduled = await fbVariant();
    if (scheduled?.status !== "scheduled") throw new Error(`Facebook version should be scheduled, is ${scheduled?.status}`);
    const chain = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, "threads"), eq(schema.contentVariants.groupId, "")) });
    if (chain?.status === "scheduled") throw new Error("the Threads chain must never be scheduled as one post");
    await page.goto(ladderUrl);
    await expectText(page, "Open in composer", "linked to the content item");
    if (await page.locator('[data-testid="stale-scheduled"]').count()) throw new Error("nothing changed yet, so no stale warning should show");
    console.log("✓ sent to the composer with the body, caption and Threads chain; the chain copy-only with its reason, the rest scheduled");

    // The seam: the ladder changes after the schedule. Re-opening in the composer never touches the scheduled post;
    // the ladder page and the composer warn, and only "Push the update" (the client's choice) replaces the text.
    const copyScheduled = await page.locator('textarea[name="copy"]').inputValue();
    const copyEdited = `One more line, added after this was scheduled.\n${copyScheduled}`;
    await fillExact(page, 'textarea[name="copy"]', copyEdited);
    await submit(page, 'button:has-text("Save and re-check")');
    await expectText(page, "Scheduled with the old text", "ladder warns at the seam");
    await expectText(page, "Facebook personal", "warning names the channel");
    await submit(page, 'button:has-text("Open in composer")');
    await page.waitForURL(/\/content\/[a-z0-9-]+\/compose/i);
    const untouched = await fbVariant();
    if (untouched?.body !== scheduled.body || untouched.status !== "scheduled") throw new Error("re-opening in the composer must leave a scheduled post exactly as it was");
    await expectText(page, "Scheduled with the old text", "composer warns at the seam");
    await page.screenshot({ path: "screenshots/ld05-stale-warning.png", fullPage: true });
    await submit(page, '[data-testid="push-update"]');
    await page.waitForURL(/pushed=/, { timeout: 15000 });
    const pushedRow = await fbVariant();
    if (!pushedRow?.body.startsWith("One more line, added after this was scheduled.") || pushedRow.status !== "scheduled" || pushedRow.postAt !== scheduled.postAt) throw new Error(`push must replace the text and leave the schedule alone: ${JSON.stringify({ body: pushedRow?.body.slice(0, 40), status: pushedRow?.status, postAt: [pushedRow?.postAt, scheduled.postAt] })}`);
    await expectText(page, "now carry", "pushed notice");
    if (await page.locator('[data-testid="stale-scheduled"]').count()) throw new Error("the warning must clear once the text matches");
    await page.goto(ladderUrl);
    if (await page.locator('[data-testid="stale-scheduled"]').count()) throw new Error("the ladder page must stop warning once the text matches");
    console.log("✓ a scheduled post keeps its text through a re-sync; warned on the ladder and in the composer; pushed only on the client's click");

    // Ladders tab on the content board, and the list shows both
    await page.goto(`${base}/content`);
    await page.click('a:has-text("Ladders")');
    await page.waitForURL(/\/content\/ladders/);
    await expectText(page, "SKIN — Mistakes Ladder", "list shows demo");
    await expectText(page, "SKIN — Loss / Rebuild", "list shows new");
    await expectText(page, "Next good slot", "cadence");
    await page.screenshot({ path: "screenshots/ld04-list.png", fullPage: true });
    console.log("✓ list and cadence");

    // ── Ship (rev 583 #1, commit 3): one press posts to the Page and Instagram through GoHighLevel with the graphic at its
    // public address, reads them back, hands the rungs to the drip naming the two posts, and writes the keyword to the bot. ──
    const { newId: newIdShip } = await import("@/lib/ids");
    const ghlRow = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.provider, "gohighlevel")) });
    if (ghlRow) await db.update(schema.integrations).set({ enabled: true, config: { ...ghlRow.config, apiUrl: `http://localhost:${ghlPort}` }, lastError: null }).where(eq(schema.integrations.id, ghlRow.id));
    else await db.insert(schema.integrations).values({ id: newIdShip(), workspaceId: ws, provider: "gohighlevel", enabled: true, config: { apiUrl: `http://localhost:${ghlPort}` } });
    // The coach installs Maya's drip (the webhook and the contact) and her Community Loyalty token, sealed by the server.
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/coach`);
    const mayaForm = 'form:has(input[name="eoPassUrl"][value*="maya-torres"])';
    await page.locator(mayaForm).first().waitFor({ timeout: 15000 });
    await page.locator(`${mayaForm} input[name="clDripWebhookUrl"]`).fill(DRIP_HOOK);
    await page.locator(`${mayaForm} [data-testid="cl-rungs-webhook"]`).fill(RUNGS_HOOK);
    await page.locator(`${mayaForm} input[name="clUserNs"]`).fill("f52594u50757435");
    await page.locator(`${mayaForm} [data-testid="cl-api-token"]`).fill(CL_TOKEN);
    await submit(page, `${mayaForm} button:has-text("Save")`);
    await fetch(`http://localhost:${uchatPort}/__seed`, { method: "POST", body: JSON.stringify({ helix_keywords_cbf: "[]", helix_keyword_agent_cbf: "" }) });
    // Maya connects her GoHighLevel sub-account with her user id, and the channel map auto-fills from the mock's accounts.
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    // The seeded connection has the location, the user and the channel map but no token: the token goes on as Settings → Publishing would put it.
    const { upsertConnection } = await import("@/lib/ghl");
    const up = await upsertConnection({ workspaceId: ws, userId: maya.id, locationId: "loc_maya", ghlUserId: "JD8kLxeYM3FqbWLQXC4p", manualToken: "pit-loc_maya" });
    if (!up.ok) throw new Error(`the Planner token could not be set: ${up.error}`);
    const conn = (await db.query.socialConnections.findFirst({ where: eq(schema.socialConnections.userId, maya.id) }))!;
    if (!conn?.mapping.fb_page || !conn.mapping.instagram || !conn.ghlUserId) throw new Error(`the Page and Instagram are mapped with a user id: ${JSON.stringify({ map: conn?.mapping, user: conn?.ghlUserId })}`);
    // The card: the graphic is done, the two posts run on Ship, the drip waits for them, the keyword runs.
    await page.goto(`${base}/content/ladders/${demoId}`);
    await page.locator('[data-testid="ship-steps"]').waitFor({ timeout: 20000 });
    const stepStates = async () => Object.fromEntries(await page.locator('[data-testid="ship-step"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-step"), e.getAttribute("data-state")])));
    let states = await stepStates();
    if (states.graphic !== "done" || states.page !== "ready" || states.instagram !== "ready" || states.drip !== "held" || states.keywords !== "ready") throw new Error(`before Ship: ${JSON.stringify(states)}`);
    if (!(await page.locator('[data-testid="ship-line"]').innerText()).startsWith("Ship runs: facebook page post, instagram post, keyword on your bot")) throw new Error(`the line names what Ship runs: ${await page.locator('[data-testid="ship-line"]').innerText()}`);
    if (await page.locator('[data-testid="ship-public-link"]').count()) throw new Error("no public address before Ship");
    await Promise.all([page.waitForURL(/ship=ran/, { timeout: 90000 }), page.locator('[data-testid="ship-button"]').click()]);
    await page.locator('[data-testid="ship-ran"]').waitFor({ timeout: 20000 });
    const shipped = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!;
    if (!shipped.graphicPublicToken || !/^[0-9a-f]{32}$/.test(shipped.graphicPublicToken) || !shipped.shippedAt) throw new Error("Ship mints the public token and marks the ladder shipped");
    const publicUrl = `${base}/api/graphics/${shipped.graphicPublicToken}.png`;
    // The two posts reached the Planner with the graphic at its public address; the address serves the master to anyone, no session.
    const plannerPosts = ((await (await fetch(`http://localhost:${ghlPort}/__posts`, { headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } })).json()) as { posts: { _id: string; accountIds: string[]; media?: { url: string }[]; summary: string; followUpComment?: string }[] }).posts;
    const shippedPosts = plannerPosts.filter((p) => p.media?.[0]?.url === publicUrl);
    if (shippedPosts.length !== 2 || !shippedPosts.some((p) => p.accountIds.some((a) => a.includes("fbpage"))) || !shippedPosts.some((p) => p.accountIds.some((a) => a.includes("_ig_")))) throw new Error(`the Page and Instagram posts carry the graphic's public address: ${JSON.stringify(plannerPosts.map((p) => [p.accountIds, p.media?.[0]?.url]))}`);
    if (shippedPosts.some((p) => p.followUpComment)) throw new Error("a shipped ladder post carries no first comment: rung 1 is the drip's");
    const pub = await fetch(publicUrl);
    const pubMeta = await sharp(Buffer.from(await pub.arrayBuffer())).metadata();
    if (pub.status !== 200 || pubMeta.width !== 2160 || pubMeta.format !== "png" || !(pub.headers.get("cache-control") ?? "").includes("public")) throw new Error(`the public address serves the master with no session: ${pub.status} ${pubMeta.width} ${pub.headers.get("cache-control")}`);
    // A token that is not live, and one that is not a token at all, read the same 404; a traversal never reaches a private route (the signed-in route answers for itself).
    if ((await fetch(`${base}/api/graphics/${"0".repeat(32)}.png`)).status !== 404 || (await fetch(`${base}/api/graphics/not-a-token.png`)).status !== 404) throw new Error("a token that is not live reads 404");
    if ((await fetch(`${base}/api/graphics/../deck-images/x`, { redirect: "manual" })).status === 200) throw new Error("a traversal never serves a private picture");
    // Read back as published, the rungs went to the drip naming the two posts; the keyword reached the bot.
    const drips = ((await (await fetch(`http://localhost:${ghlPort}/__drips`)).json()) as { drips: { path: string; body: Record<string, string> }[] }).drips;
    // One hand-off, to the rungs-only webhook, never the old publisher one (it would post again).
    if (drips.length !== 1 || !drips[0].path.endsWith("ru0123456789abcdef0123456789abcd") || drips[0].body.user_ns !== "f52594u50757435") throw new Error(`one hand-off, to the rungs webhook: ${JSON.stringify(drips.map((d) => d.path))}`);
    const sentDrip = drips[0].body;
    const ids = shippedPosts.map((p) => p._id);
    if (sentDrip.target !== "both" || !ids.includes(sentDrip.rung_fb_post_id) || !ids.includes(sentDrip.rung_ig_media_id) || sentDrip.gap_minutes !== "") throw new Error(`the hand-off names where the rungs land and the two posts: ${JSON.stringify({ target: sentDrip.target, fb: sentDrip.rung_fb_post_id, ig: sentDrip.rung_ig_media_id, gap: sentDrip.gap_minutes })}`);
    // The contract (rev 625): the rungs as an array, each numbered on its first line; never the post or a first comment.
    const sentRungs = sentDrip.rungs as unknown as string[];
    const demoRungs = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!.rungs;
    if (!Array.isArray(sentRungs) || sentRungs.length !== demoRungs.length || !sentRungs.every((r, i) => r.startsWith(`${i + 1}. `)) || "post" in sentDrip || "first_comment" in sentDrip) throw new Error(`the rungs go as numbered strings, and nothing else: ${JSON.stringify(Object.keys(sentDrip))}`);
    if (!decodeURIComponent(page.url()).includes(`Rungs queued: ${demoRungs.length}, first one in about 5 minutes`)) throw new Error(`Ship says the rungs are queued: ${decodeURIComponent(page.url())}`);
    const handoff = (await db.query.dripHandoffs.findFirst({ where: eq(schema.dripHandoffs.ladderId, demoId) }))!;
    if (handoff?.target !== "both" || handoff.fbPostId !== sentDrip.rung_fb_post_id || handoff.igMediaId !== sentDrip.rung_ig_media_id || handoff.pinLast) throw new Error(`the hand-off row keeps the target and the ids: ${JSON.stringify(handoff)}`);
    const botFields = (await (await fetch(`http://localhost:${uchatPort}/__fields`)).json()) as Record<string, string>;
    const routed = JSON.parse(botFields.helix_keywords_cbf ?? "[]") as { keyword: string }[];
    if (!routed.some((k) => k.keyword === "RESET")) throw new Error(`the keyword reached the bot: ${botFields.helix_keywords_cbf}`);
    states = await stepStates();
    if (Object.values(states).some((v) => v !== "done")) throw new Error(`after Ship every step is done: ${JSON.stringify(states)}`);
    if ((await page.locator('[data-testid="ship-line"]').innerText()) !== "Shipped: every step is done.") throw new Error("the line says shipped");
    if (!(await page.locator('[data-testid="ship-button"]').isDisabled())) throw new Error("nothing left to run, Ship is shut");
    // Sent with the graphic, read back with it: no warning on the post. A post the platform let out bare says so on the post.
    const pageVariant = (await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.channel, "fb_page"), eq(schema.contentVariants.groupId, ""), eq(schema.contentVariants.externalId, shippedPosts.find((p) => p.accountIds.some((a) => a.includes("fbpage")))!._id)) }))!;
    if (pageVariant.externalError) throw new Error(`a post read back with its picture carries no warning: ${pageVariant.externalError}`);
    const stripped = await fetch(`http://localhost:${ghlPort}/__strip-media?id=${pageVariant.externalId}`, { method: "POST", headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } });
    if (!stripped.ok) throw new Error(`the mock planner drops the post's picture: ${stripped.status}`);
    const { POSTED_WITHOUT_PICTURE } = await import("@/lib/planner-status");
    await page.goto(`${base}/content/${pageVariant.contentItemId}/repurpose`);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('button:has-text("Check every version with GoHighLevel")').click()]);
    await page.waitForLoadState("networkidle");
    if ((await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, pageVariant.id) }))?.externalError !== POSTED_WITHOUT_PICTURE) throw new Error("a post the planner holds without its picture says so on the post");
    if (!(await page.locator("main").innerText()).includes("Posted without the picture")) throw new Error("the page says the post went out without its picture");
    await page.goto(`${base}/content/ladders/${demoId}`);
    console.log("✓ Ship: both posts sent with the graphic and read back with it; one the platform let out bare says \"Posted without the picture\" on the post");
    // Revoke: the address dies, the graphic stays.
    await Promise.all([page.waitForURL(/ship=revoked/, { timeout: 20000 }), page.locator('[data-testid="ship-revoke"]').click()]);
    if ((await fetch(publicUrl)).status !== 404) throw new Error("a revoked address reads 404");
    const revoked = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, demoId) }))!;
    if (revoked.graphicPublicToken || !revoked.graphicImageId) throw new Error("Revoke clears the token and keeps the graphic");
    console.log("✓ Ship: the Page and Instagram posts through GoHighLevel with the graphic at its public address (served with no session, 404 otherwise), read back, the rungs handed to the drip naming both posts, the keyword on the bot, every step done; Revoke kills the address");
  } finally {
    await browser.close();
    for (const m of [blob, ghl, uchat]) if (m.pid) try { process.kill(-m.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Ladders smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
