/**
 * Avatars (rev 501, built by Body at rev 508):
 *  1. The first visit brings each offer's free-text avatar in, once, marked "imported, please review" and linked as the main.
 *  2. A new avatar, filled and saved; a sub-segment nests under it; Duplicate, Archive with Undo, and Make Primary.
 *  3. Linked to an offer from the avatar's page, made main from the offer's "Who it's for"; an offer with none says so.
 *  4. The Pathway's Day 1 writes into the Primary and leaves the fields it doesn't ask alone.
 *  5. Drafts and the webinar's "Who it is for" read the offer's main avatar; the coach sees the count, read-only.
 *  6. The connector's four tools list, add, update and link, by name.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`${selector} wouldn't hold "${value}"`);
}
async function expectText(page: Page, text: string, what: string) {
  if (!(await page.getByText(text, { exact: false }).first().isVisible().catch(() => false))) throw new Error(`${what}: "${text}" not on ${page.url()}`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { importPlan, coachLine, IMPORTED_NOTE } = await import("@/lib/engine/avatars");
  const { avatarData, draftAvatarBrief } = await import("@/lib/avatars");
  const { contextFor } = await import("@/lib/queries/webinar");
  await import("@/lib/mcp/tools/index");
  const { allTools } = await import("@/lib/mcp/registry");

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mem = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const m = { workspaceId: mem.workspaceId, userId: maya.id };
  // A clean start: no avatars, so the first visit's import runs. The offers are read for what it should bring in.
  await db.delete(schema.avatarOffers).where(and(eq(schema.avatarOffers.workspaceId, m.workspaceId), eq(schema.avatarOffers.userId, m.userId)));
  await db.delete(schema.avatars).where(and(eq(schema.avatars.workspaceId, m.workspaceId), eq(schema.avatars.userId, m.userId)));
  const offers = await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, m.workspaceId), eq(schema.offers.userId, m.userId)) });
  const plan = importPlan(offers, false);
  if (!plan.length) throw new Error("the walk needs an offer with a free-text avatar to import (the seed's 90-Day Reset has one)");
  const plain = offers.find((o) => !o.avatar?.trim()) ?? null;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 950 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
    await login(page, "As a client");

    // ── 1. The import, once. ──
    await page.goto(`${base}/avatars`);
    await expectText(page, `Brought in ${plan.length} avatar`, "the import says what it brought in");
    const names = await page.locator('[data-testid="avatar-name"]').allInnerTexts();
    for (const p of plan) if (!names.includes(p.name)) throw new Error(`imported "${p.name}" is a card: ${names.join("; ")}`);
    if ((await page.getByText(IMPORTED_NOTE).count()) < plan.length) throw new Error("each import is marked for review");
    const chips = await page.locator('[data-testid="avatar-offers"]').first().innerText();
    const firstOffer = offers.find((o) => o.id === plan[0].offerIds[0])!;
    if (!chips.includes(`★ ${firstOffer.name}`)) throw new Error(`the import is the offer's main: ${chips}`);
    await page.goto(`${base}/avatars`);
    if (await page.locator('[data-testid="avatar-imported"]').count()) throw new Error("the import runs once");
    if ((await page.locator('[data-testid="avatar-card"]').count()) !== plan.length) throw new Error("a second visit adds nothing");
    console.log(`✓ the first visit brings ${plan.length} offer avatar(s) in once, marked ${IMPORTED_NOTE}, as the offer's main`);

    // ── 2. New, fill, sub-segment, duplicate, archive and undo, primary. ──
    await page.click('summary:has-text("+ New avatar")');
    await fillExact(page, '[data-testid="avatar-new"] input[name="name"]', "Walk Coaches");
    await submit(page, '[data-testid="avatar-new"] button:has-text("Add and fill it in")');
    await page.waitForURL(/\/avatars\/[\w-]+\?saved=1/);
    const walkId = /\/avatars\/([\w-]+)/.exec(page.url())![1];
    await fillExact(page, '[data-testid="avatar-pains"]', "No evenings left\nTurning people away");
    await fillExact(page, '[data-testid="avatar-phrases"]', "I'm drowning in DMs");
    await fillExact(page, '[data-testid="avatar-objections"]', "I've tried a VA");
    await submit(page, '[data-testid="avatar-form"] button:has-text("Save avatar")');
    await expectText(page, "Saved.", "the save says so");
    const saved = (await db.query.avatars.findFirst({ where: eq(schema.avatars.id, walkId) }))!;
    if (saved.pains !== "No evenings left\nTurning people away" || saved.objections !== "I've tried a VA" || saved.userId !== maya.id) throw new Error("the fields are saved as typed, as Maya's");
    await page.goto(`${base}/avatars`);
    await page.click('summary:has-text("+ New avatar")');
    await fillExact(page, '[data-testid="avatar-new"] input[name="name"]', "Walk Coaches · Evenings");
    await page.selectOption('[data-testid="avatar-new"] select[name="parentId"]', walkId);
    await submit(page, '[data-testid="avatar-new"] button:has-text("Add and fill it in")');
    await page.goto(`${base}/avatars`);
    const card = page.locator('[data-testid="avatar-card"]', { hasText: "Walk Coaches" }).first();
    if (!(await card.locator('[data-testid="avatar-subs"]').innerText()).includes("Walk Coaches · Evenings")) throw new Error("the sub-segment nests under its parent");
    await page.goto(`${base}/avatars/${walkId}`);
    await submit(page, 'button:has-text("Duplicate")');
    await expectText(page, "Duplicated", "the copy opens");
    const copyId = /\/avatars\/([\w-]+)/.exec(page.url())![1];
    if ((await page.locator("h1").innerText()).trim() !== "Walk Coaches (copy)") throw new Error("the copy is named (copy)");
    await submit(page, 'button:has-text("Archive")');
    await page.waitForURL(/\/avatars\?archived=/);
    if (await page.locator('[data-testid="avatar-name"]', { hasText: "Walk Coaches (copy)" }).count()) throw new Error("an archived avatar leaves the cards");
    await submit(page, '[data-testid="avatar-archived"] button:has-text("Undo")');
    if ((await db.query.avatars.findFirst({ where: eq(schema.avatars.id, copyId) }))!.archivedAt) throw new Error("Undo brings it back");
    await page.goto(`${base}/avatars/${copyId}`);
    await submit(page, 'button:has-text("Archive")');
    // The first avatar the member adds is their Primary (an import never is); the star moves and comes back.
    if (!(await db.query.avatars.findFirst({ where: eq(schema.avatars.id, walkId) }))!.primary) throw new Error("the first avatar added is the Primary");
    const importedId = (await db.query.avatars.findFirst({ where: and(eq(schema.avatars.userId, maya.id), eq(schema.avatars.imported, true)) }))!.id;
    for (const id of [importedId, walkId]) {
      await page.goto(`${base}/avatars/${id}`);
      await submit(page, 'button:has-text("★ Make Primary")');
      const prim = await db.query.avatars.findMany({ where: and(eq(schema.avatars.userId, maya.id), eq(schema.avatars.primary, true)) });
      if (prim.length !== 1 || prim[0].id !== id) throw new Error("one Primary, the one starred");
    }
    console.log("✓ a new avatar saved as typed; a sub-segment nests; Duplicate, Archive with Undo, and one Primary");

    // ── 3. Offers both ways. ──
    await page.selectOption('[data-testid="avatar-link"] select[name="offerId"]', firstOffer.id);
    await submit(page, '[data-testid="avatar-link"] button:has-text("Link")');
    if (!(await page.locator('[data-testid="avatar-linked"]').innerText()).includes(firstOffer.name)) throw new Error("linked from the avatar's page");
    await page.goto(`${base}/offers/${firstOffer.id}`);
    const who = page.locator('[data-testid="offer-avatars"]');
    if (!(await who.innerText()).includes(`★ ${plan[0].name}`)) throw new Error("the import stays main when another is linked");
    await submit(page, '[data-testid="offer-avatars"] li:has-text("Walk Coaches") button:has-text("Make main")');
    if (!(await page.locator('[data-testid="offer-avatars"] li').first().innerText()).startsWith("★ Walk Coaches")) throw new Error("Make main moves the star, main first");
    const mains = (await db.query.avatarOffers.findMany({ where: eq(schema.avatarOffers.offerId, firstOffer.id) })).filter((l) => l.main);
    if (mains.length !== 1 || mains[0].avatarId !== walkId) throw new Error("one main per offer");
    if (plain) {
      await page.goto(`${base}/offers/${plain.id}`);
      const none = await page.locator('[data-testid="offer-no-avatar"]').innerText();
      if (!none.startsWith("No avatar linked yet.") || !none.includes("write to your Primary, Walk Coaches")) throw new Error(`an offer with none says so gently, naming the Primary its drafts fall back to: ${none}`);
    }
    console.log(`✓ linked from the avatar, made main from ${firstOffer.name}'s Who it's for (one main), and an offer with none says so`);

    // ── 4. Day 1 of the 30-day build writes into the Primary. ──
    const day1 = await db.query.curriculumDays.findFirst({ where: eq(schema.curriculumDays.day, 1) });
    if (!day1 || !/buyer avatar/i.test(day1.title)) throw new Error("Day 1 is Define Your Buyer Avatar");
    await db.delete(schema.curriculumProgress).where(and(eq(schema.curriculumProgress.userId, maya.id), eq(schema.curriculumProgress.day, 1)));
    await page.goto(`${base}/pathway`);
    const define = page.locator('[data-testid="define-avatar"]');
    if ((await define.locator('input[name="name"]').inputValue()) !== "Walk Coaches") throw new Error("Day 1 opens on the Primary");
    await fillExact(page, '[data-testid="define-avatar"] textarea[name="who"]', "Coaches two years in, fully booked 1:1");
    await fillExact(page, '[data-testid="define-avatar"] textarea[name="wants"]', "Evenings back");
    await submit(page, '[data-testid="define-avatar"] button:has-text("Save to my Primary avatar")');
    await page.locator('[data-testid="define-avatar-saved"]').waitFor();
    const after = (await db.query.avatars.findFirst({ where: eq(schema.avatars.id, walkId) }))!;
    if (after.who !== "Coaches two years in, fully booked 1:1" || after.wants !== "Evenings back") throw new Error("Day 1's answers are on the Primary");
    if (after.objections !== "I've tried a VA" || after.phrases !== "I'm drowning in DMs") throw new Error("the fields Day 1 doesn't ask are left alone");
    console.log("✓ Day 1 writes into the Primary and leaves the other fields alone");

    // ── 5. Drafts, the webinar's fit, the coach. ──
    const brief = await draftAvatarBrief(m, firstOffer.id);
    if (!brief.startsWith(`WHO IT'S FOR: the member's own buyer avatar "Walk Coaches"`) || !brief.includes("I'm drowning in DMs") || !brief.includes("never invent")) throw new Error(`a draft for the offer reads its main avatar, in Maya's words: ${brief.slice(0, 120)}`);
    const web = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, maya.id), eq(schema.webinars.offerId, firstOffer.id)) });
    if (web) {
      await db.update(schema.offers).set({ forYouIf: null, notForYouIf: null }).where(eq(schema.offers.id, firstOffer.id));
      const fit = (await contextFor(web)).fit;
      if (fit.forYouIf !== "Coaches two years in, fully booked 1:1") throw new Error(`the webinar's "Who it is for" is the main avatar's when the offer's is empty: ${fit.forYouIf}`);
      await db.update(schema.offers).set({ forYouIf: "Offer's own line" }).where(eq(schema.offers.id, firstOffer.id));
      if ((await contextFor(web)).fit.forYouIf !== "Offer's own line") throw new Error("the offer's own line wins");
      console.log(`✓ drafts read the main avatar; ${web.title}'s Who it is for uses it when the offer's is empty, and the offer's own line wins`);
    } else console.log("✓ drafts read the main avatar (no webinar on this offer to check the fit)");
    const coachPage = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
    await login(coachPage, "As the coach");
    await coachPage.goto(`${base}/coach/${mem.id}`);
    const data = await avatarData(m);
    const line = (await coachPage.locator('[data-testid="coach-avatars-line"]').innerText()).trim();
    if (line !== coachLine(data.rows, data.links)) throw new Error(`the coach sees "${coachLine(data.rows, data.links)}": ${line}`);
    if (await coachPage.locator('[data-testid="coach-avatars"] form, [data-testid="coach-avatars"] button').count()) throw new Error("read-only for the coach");
    console.log(`✓ the coach sees "${line}", read-only`);
    await coachPage.close();

    // ── 6. The connector. ──
    const tool = (n: string) => allTools().find((t) => t.name === n)!;
    const v = { workspace: { id: m.workspaceId }, user: { id: m.userId } } as never;
    const list = await tool("avatars_list").handler(v, {});
    if (!list.text.includes("★ Walk Coaches") || !list.text.includes("· Walk Coaches · Evenings")) throw new Error(`avatars_list shows the Primary and the sub-segment: ${list.text}`);
    await tool("avatar_add").handler(v, { name: "Walk Voice", pains: "Slow launches" });
    await tool("avatar_update").handler(v, { avatar: "walk voice", objections: "Too busy" });
    const voice = (await db.query.avatars.findFirst({ where: and(eq(schema.avatars.userId, maya.id), eq(schema.avatars.name, "Walk Voice")) }))!;
    if (voice.pains !== "Slow launches" || voice.objections !== "Too busy") throw new Error("update changes only what it's given");
    const linked = await tool("offer_link_avatar").handler(v, { avatar: "Walk Voice", offer: firstOffer.name });
    if (!linked.text.startsWith(`Linked "Walk Voice" to ${firstOffer.name}`) || /main/.test(linked.text)) throw new Error(`linked, not main, since the offer has one: ${linked.text}`);
    await tool("offer_link_avatar").handler(v, { avatar: "Walk Voice", offer: firstOffer.name, unlink: true });
    if (await db.query.avatarOffers.findFirst({ where: and(eq(schema.avatarOffers.avatarId, voice.id), eq(schema.avatarOffers.offerId, firstOffer.id)) })) throw new Error("unlink removes the link");
    await tool("avatar_update").handler(v, { avatar: "Walk" }).then(
      () => {
        throw new Error("words that fit several avatars are refused");
      },
      (e: Error) => {
        if (!/fits \d+ avatars/.test(e.message)) throw e;
      },
    );
    console.log("✓ the connector lists, adds, updates only what it's given, links and unlinks by name, and asks when a name fits several");
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`server errors on the way:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
