/**
 * A new client's first deck (first-deck brief §2, 5 Oct): a webinar with no proof and no stories, every one of its 20 sections
 * drafted with ✨, exports with slides in every act. The draft writes the deck lines with the script; a line quoting a figure
 * the record never gave is dropped; the proof slide keeps [PROOF PLACEHOLDER]; the closing frame's draft names the linked
 * offer's own price; "2 a.m." stays "2 a.m."; an answer cut off at the output budget is never saved; a section with a script
 * and no key points is named on the Deck step and gets its slides from "Make slides from my script"; the Key points box
 * carries no other coach's example. Runs against scripts/mock-ai.ts (the dev server must have AI_BASE_URL=http://localhost:4020).
 * §1, the house starter kit, and §3, the logo: with none, a red "Your logo here" on the cover; a dark wordmark on the dark cover
 * sits on a ground badge; the kit's "Logo for dark backgrounds" takes its place there; with a logo the footer drops the brand
 * line; a logo uploaded in the kit editor lists at its real size. Runs against scripts/mock-blob.ts too.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const blobPort = 4050;
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
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  await fetch(`http://localhost:${blobPort}/__reset`);
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
    // The walk drafts some 25 times; a second run on the same day would meet the client's daily cap (40 calls) partway through.
    await db.delete(schema.aiUsage).where(eq(schema.aiUsage.userId, user.id));
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
    // The proof placeholder stays in the script, never on a proof slide: there it would refuse the whole export.
    must(drafted.filter((s) => /proof block/i.test(s.name)).every((s) => s.script?.includes("[PROOF PLACEHOLDER]") && !(s.keyPoints ?? "").includes("[PROOF PLACEHOLDER]") && (s.keyPoints ?? "").trim()), "each proof block keeps [PROOF PLACEHOLDER] in its script, and slides without it");
    for (const s of drafted) must((s.keyPoints ?? "").split("\n").length <= slideCountFor(s.durationMin) + 2, `${s.name}: about one line per two minutes`);
    const price = `$${offer.price.toLocaleString("en-US")}`;
    const stack = drafted.find((s) => s.act === "closing" && /offer stack/i.test(s.name))!;
    must(stack.script?.includes(price) && (stack.keyPoints ?? "").includes(price), `the closing frame's draft names the linked offer's own price, ${price}, in the script and on a slide`);
    console.log(`✓ ${drafted.length} sections drafted with ✨: each has its slides; a made-up figure dropped; the proof placeholder kept in the script and off the proof slides; "2 a.m." intact; the offer stack names ${price}`);

    // ── The export has slides in every act, and none of them invents a result. ──
    const deck = deckSlides(await contextFor(await w()), null);
    for (const act of ["opening", "vehicle", "internal", "external", "closing"]) {
      const n = deck.slides.filter((s) => s.act === act && s.kind !== "divider").length;
      must(n > 0, `the deck has slides in the ${act} act (${n})`);
    }
    must(!deck.slides.some((s) => [s.headline, ...s.body].join(" ").includes("47%")), "no slide carries the made-up figure");
    must(deck.refused.length === 0, `a drafted deck exports: nothing refused (${deck.refused.join(" | ")})`);
    await page.goto(`${base}/webinars/${webinarId}?step=deck`);
    await page.locator('[data-testid="deck-pace"]').waitFor({ timeout: 20000 });
    must(!(await page.locator('[data-testid="deck-partial"]').count()) && !(await page.locator('[data-testid="deck-script-only"]').count()), "the Deck step says nothing is missing");
    console.log(`✓ the export: ${deck.slides.length} slides with teaching in every act, no made-up figure, nothing refused; the Deck step names nothing missing`);

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

    // ── §1, the house starter kit: a workspace with no kit of its own renders in the starter, named as such; Settings shows it
    //    pre-filled to edit; a saved kit takes over; Reset to the starter kit brings it back. ──
    // A run that failed partway may have left its kit or its footer bar: §1 starts from no kit of the workspace's own.
    await db.delete(schema.brandKits).where(eq(schema.brandKits.workspaceId, (await w()).workspaceId));
    await db.update(schema.webinars).set({ footerBar: false }).where(eq(schema.webinars.id, webinarId));
    must(deck.kit.name === "House starter kit" && !deck.kitApplied && deck.kit.displayFont === "Montserrat" && deck.refused.length === 0, "with no kit of its own, the deck renders in the house starter kit");
    await page.goto(`${base}/webinars/${webinarId}?step=deck`);
    must((await page.locator('[data-testid="deck-kit-name"]').innerText()).includes("house starter kit"), "the Deck step says it is the house starter kit");
    const { ownerBrandName } = await import("@/lib/queries/webinar");
    must((await ownerBrandName(await w(), "the workspace")) !== "House starter kit", "the footer names the member's business, never the starter kit");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As the coach")');
    await page.waitForURL(/\/today/);
    await page.goto(`${base}/settings#brand-kit`);
    await page.locator('[data-testid="brand-starter"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="brand-hex-ground"]').inputValue()) === "F7F5F0" && (await page.locator('[data-testid="brand-form"] input[name="displayFont"]').inputValue()) === "Montserrat", "Settings shows the starter kit pre-filled, to edit rather than start blank");
    await page.fill('[data-testid="brand-form"] input[name="name"]', "Rooted Rest");
    await submit(page, '[data-testid="brand-form"] button[type="submit"]');
    await page.locator('[data-testid="brand-saved"]').waitFor({ timeout: 20000 });
    const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) }))!.workspaceId;
    must((await db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, ws) }))?.name === "Rooted Rest", "a saved kit takes over");
    must(!(await page.locator('[data-testid="brand-starter"]').count()), "with a kit of its own, the starter line goes");
    page.once("dialog", (d) => d.accept());
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('button:has-text("Reset to the starter kit")').click()]);
    await page.locator('[data-testid="brand-reset"]').waitFor({ timeout: 20000 });
    must(!(await db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, ws) })) && (await page.locator('[data-testid="brand-starter"]').count()) === 1, "Reset to the starter kit clears the saved kit, with a confirm, and the starter is back");
    console.log("✓ §1: no kit of its own renders in the house starter kit, named on the Deck step, the footer the member's business; Settings shows it pre-filled; a saved kit takes over; Reset brings the starter back");

    // ── §3, the logo. A logo uploaded in the kit editor lists at its real size, never 0×0. ──
    const { default: sharp } = await import("sharp");
    const { newId } = await import("@/lib/ids");
    const { logoColor } = await import("@/lib/deck-media");
    const wordmark = (rgb: { r: number; g: number; b: number }) =>
      sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: { create: { width: 240, height: 60, channels: 4, background: { ...rgb, alpha: 1 } } }, left: 30, top: 20 }])
        .png()
        .toBuffer();
    const AUBERGINE = { r: 0x3b, g: 0x1f, b: 0x3a };
    const CREAM = { r: 0xf7, g: 0xf5, b: 0xf0 };
    await page.locator('[data-testid="brand-logo-upload"] summary').click();
    await page.setInputFiles('[data-testid="brand-logo-upload"] [data-testid="deck-image-file"]', { name: "wordmark.png", mimeType: "image/png", buffer: await wordmark(AUBERGINE) });
    await page.click('[data-testid="brand-logo-upload"] [data-testid="deck-image-send"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="brand-logo"]') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.includes("300×100"), null, { timeout: 20000 });
    must(!(await page.locator('[data-testid="brand-logo"] option, [data-testid="brand-logo-dark"] option').allInnerTexts()).some((t) => t.includes("0×0")), "no logo in the kit editor lists as 0×0");
    must((await page.locator('[data-testid="brand-logo-dark"] option').allInnerTexts()).some((t) => t.includes("300×100")), "the new logo is offered as the dark-background logo too");
    console.log("✓ §3: a logo uploaded in the kit editor lists at its real size (300×100), in both pickers");

    // The client's own deck: no logo anywhere, then a dark wordmark, then the kit's dark-background logo. The drafts are marked
    // reviewed so the export goes (the provenance gate has its own walk).
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const wsId = (await w()).workspaceId;
    await db.update(schema.webinarSections).set({ origin: "ai_accepted" }).where(eq(schema.webinarSections.webinarId, webinarId));
    await db.delete(schema.deckImages).where(and(eq(schema.deckImages.userId, user.id), eq(schema.deckImages.kind, "logo")));
    const putLogo = async (name: string, bytes: Buffer) => {
      const pathname = `deck/${wsId}/${user.id}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      const res = await fetch(`http://localhost:${blobPort}/?pathname=${encodeURIComponent(pathname)}`, { method: "PUT", headers: { authorization: `Bearer ${process.env.PROOF_BLOB_READ_WRITE_TOKEN ?? "vercel_blob_rw_PROOFSTORE_testsecret"}`, "x-vercel-blob-access": "private", "x-content-type": "image/png", "x-allow-overwrite": "1" }, body: new Uint8Array(bytes) });
      const { url } = (await res.json()) as { url: string };
      const [row] = await db.insert(schema.deckImages).values({ id: newId(), workspaceId: wsId, userId: user.id, kind: "logo", blobKey: pathname, blobUrl: url, mime: "image/png", width: 300, height: 100, caption: name }).returning();
      return row;
    };
    const JSZip = (await import("jszip")).default;
    const exportCover = async () => {
      const res = await page.request.get(`${base}/api/webinars/${webinarId}/deck?format=pptx`);
      must(res.ok(), `the deck exports: ${res.status()} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const zip = await JSZip.loadAsync(await res.body());
      const cover = await zip.file("ppt/slides/slide1.xml")!.async("string");
      const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
      const content = await zip.file("ppt/slides/slide3.xml")!.async("string");
      const media = [...rels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => `ppt/media/${m[1]}`);
      const pics = await Promise.all(media.map(async (m) => logoColor(await zip.file(m)!.async("nodebuffer"))));
      return { cover, content, pics, badge: (cover.match(/prst="roundRect"/g) ?? []).length, placeholder: cover.includes("Your logo here") };
    };
    const thumbCover = async () => {
      await page.goto(`${base}/webinars/${webinarId}?step=deck`);
      const t = page.locator('[data-testid="deck-thumb"][data-n="1"]').first();
      await t.waitFor({ timeout: 20000 });
      return { placeholder: await t.locator('[data-testid="deck-thumb-logo-placeholder"]').count(), badge: await t.locator('[data-testid="deck-thumb-logo-badge"]').count(), src: await t.locator('[data-testid="deck-thumb-cover-logo"]').getAttribute("src").catch(() => null) };
    };
    // No logo at all: the cover says what to add, in red, and nothing else carries a placeholder for it.
    let x = await exportCover();
    must(x.placeholder && x.cover.includes('prstDash val="dash"') && !x.pics.length && !x.content.includes("Your logo here"), "with no logo, the cover alone carries a red dashed \"Your logo here\"");
    let t = await thumbCover();
    must(t.placeholder === 1 && !t.src, "the Deck step's cover thumbnail shows the same \"Your logo here\"");
    must((await page.locator('[data-testid="deck-check"]').innerText()).includes("Your logo here"), "the check before download says the cover shows the placeholder");
    // A dark wordmark: on the dark starter cover it would read at about 1.2:1, so it sits on a ground badge.
    const dark = await putLogo("Aubergine wordmark", await wordmark(AUBERGINE));
    x = await exportCover();
    must(!x.placeholder && x.badge === 1 && x.pics.length === 1, `a dark logo on the dark cover sits on one badge, the placeholder gone: ${JSON.stringify({ badge: x.badge, pics: x.pics })}`);
    t = await thumbCover();
    must(t.badge === 1 && t.placeholder === 0 && t.src === `/api/deck-images/${dark.id}`, "the cover thumbnail shows the logo on its badge");
    // The kit's "Logo for dark backgrounds": the cream one takes the cover, bare; the footer bar keeps the dark one.
    const light = await putLogo("Cream wordmark", await wordmark(CREAM));
    const { STARTER_KIT } = await import("@/lib/engine/deck");
    const k = STARTER_KIT;
    await db.insert(schema.brandKits).values({ id: newId(), workspaceId: wsId, name: "Walk kit", ground: k.ground, ink: k.ink, accent: k.accent, muted: k.muted, surface: k.surface, inverseGround: k.inverseGround, inverseInk: k.inverseInk, displayFont: k.displayFont, bodyFont: k.bodyFont, quoteFont: k.quoteFont, fontFallback: k.fontFallback, logoImageId: dark.id, logoDarkImageId: light.id });
    await db.update(schema.webinars).set({ footerBar: true }).where(eq(schema.webinars.id, webinarId));
    x = await exportCover();
    // With a logo in the footer bar, the brand line beside it goes: the footer said the brand twice.
    must(x.content.includes("<p:pic>") && !x.content.includes("<a:t>Walk kit</a:t>"), "with a logo, the footer bar carries the logo and no brand line");
    must(x.badge === 0 && x.pics.length === 1 && [0, 2, 4].every((i) => Math.abs(parseInt(x.pics[0]?.slice(i, i + 2) ?? "0", 16) - parseInt("F7F5F0".slice(i, i + 2), 16)) <= 8), `the cover carries the kit's dark-background logo, bare: ${JSON.stringify(x.pics)}`);
    t = await thumbCover();
    must(t.badge === 0 && t.src === `/api/deck-images/${light.id}`, "the cover thumbnail shows the dark-background logo");
    await db.delete(schema.brandKits).where(eq(schema.brandKits.workspaceId, wsId));
    await db.update(schema.webinars).set({ footerBar: false }).where(eq(schema.webinars.id, webinarId));
    console.log("✓ §3: no logo, a red \"Your logo here\" on the cover only; a dark wordmark on the dark cover sits on a ground badge; the kit's dark-background logo takes the cover bare; the footer bar's logo stands without the brand line; the thumbnails agree");

    // ── §4 and §5, off the file: placeholder text at 20pt, body at 24pt where there is room, the cover's date line; the price
    //    slide; the CTA once, on the offer and Q&A slides only, the bar replacing the footer's line; the deck ends on the CTA. ──
    const CTA = "Book your call at the link below";
    await db.update(schema.offers).set({ ctaFooter: CTA }).where(eq(schema.offers.id, offer.id));
    await db.update(schema.webinars).set({ scheduledAt: "2026-10-12T18:00", ctaType: "Book a call", ctaBar: false }).where(eq(schema.webinars.id, webinarId));
    const slidesOf = async () => {
      const res = await page.request.get(`${base}/api/webinars/${webinarId}/deck?format=pptx`);
      must(res.ok(), `the deck exports: ${res.status()}`);
      const zip = await JSZip.loadAsync(await res.body());
      const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      return Promise.all(files.map((f) => zip.file(f)!.async("string")));
    };
    let xml = await slidesOf();
    must(xml[0].includes("Monday 12 October 2026 · 6:00 PM"), "the cover carries the event's date and time under the presenter");
    const placeholderRuns = xml.join("").match(/<a:rPr[^>]*sz="(\d+)"[^>]*>(?:(?!<\/a:rPr>)[\s\S])*?<\/a:rPr>\s*<a:t>Add [^<]*<\/a:t>/g) ?? [];
    must(placeholderRuns.length > 0 && placeholderRuns.every((r) => /sz="2000"/.test(r)), `the red placeholder text is 20pt: ${placeholderRuns.slice(0, 2).join(" | ").slice(0, 300)}`);
    must(xml.some((x) => /sz="2400"/.test(x)), "a body line with room is set at 24pt");
    const priceXml = xml.find((x) => x.includes("Get started today"));
    must(priceXml && /strike="sngStrike"/.test(priceXml) && !priceXml.includes(`<a:t>${offer.name}</a:t>`), "the price slide reads Get started today, the total struck through, and never the offer's internal name as the line");
    const withCta = xml.map((x, i) => (x.includes(CTA) ? i + 1 : 0)).filter(Boolean);
    must(xml.at(-1)!.includes("Your questions") && xml.at(-2)!.includes("Book a call") && withCta.includes(xml.length), `the deck ends on the call to action, then Q&A with the CTA on screen: ${withCta.join(",")}`);
    const ctaDeck = deckSlides(await contextFor(await w()), null);
    const ctaKinds = new Set(ctaDeck.slides.filter((sl) => sl.footer === CTA || sl.body.includes(CTA)).map((sl) => (sl.kind === "close" ? "close" : sl.sectionKey)));
    must([...ctaKinds].every((k) => k === "close" || k === "offer_stack_cta" || k === "q_a_close"), `the CTA sits on the offer, Q&A and closing slides only: ${[...ctaKinds].join(", ")}`);
    await db.update(schema.webinars).set({ ctaBar: true }).where(eq(schema.webinars.id, webinarId));
    xml = await slidesOf();
    const twice = xml.map((x, i) => ((x.match(new RegExp(CTA, "g")) ?? []).length > 1 ? i + 1 : 0)).filter(Boolean);
    must(!twice.length && xml.filter((x) => x.includes(CTA)).length === withCta.length, `with the CTA bar on, the bar replaces the footer's line on the same slides, never both: slides ${twice.join(",")}`);
    await db.update(schema.webinars).set({ ctaBar: false }).where(eq(schema.webinars.id, webinarId));
    console.log(`✓ §4 and §5: placeholder text at 20pt, body at 24pt, the cover's date line; the price slide with the total struck through; the CTA on slides ${withCta.join(", ")} of ${xml.length} only, once with the bar on; the deck ends on the CTA and Q&A`);

    // ── §6: the thumbnails load the kit's Google faces, and the CSP lets them in; a second upload into another slot attaches. ──
    await page.goto(`${base}/webinars/${webinarId}?step=deck`);
    await page.locator('[data-testid="deck-thumb"]').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.head.querySelectorAll('link[data-testid="deck-thumb-font"]').length >= 2, null, { timeout: 10000 });
    const fontHrefs = await page.locator('link[data-testid="deck-thumb-font"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    must((await page.locator('[data-testid="deck-honesty"]').count()) === 1, "the Deck step renders once");
    must(fontHrefs.some((h) => h.includes("family=Montserrat")) && fontHrefs.some((h) => h.includes("family=Playfair+Display")), `the thumbnails load the starter kit's Google faces: ${fontHrefs.join(" ")}`);
    const csp = (await page.request.get(`${base}/today`)).headers()["content-security-policy"] ?? "";
    must(/style-src[^;]*https:\/\/fonts\.googleapis\.com/.test(csp) && /font-src[^;]*https:\/\/fonts\.gstatic\.com/.test(csp), "the CSP names the Google font hosts, and nothing wider");
    const slotPng = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 20, g: 90, b: 200 } } }).png().toBuffer();
    const openSlots = page.locator('[data-testid="deck-slot"]:has([data-testid="deck-slot-upload"])');
    const slotKeys = [...new Set(await openSlots.evaluateAll((els) => els.map((e) => e.getAttribute("data-slot-key") ?? "")))].filter((k) => !k.includes("testimonial")).slice(0, 2);
    must(slotKeys.length === 2, `two empty slots to fill: ${slotKeys.join(", ")}`);
    for (const key of slotKeys) {
      const slot = page.locator(`[data-testid="deck-slot"][data-slot-key="${key}"]`);
      await slot.locator('[data-testid="deck-slot-upload"] summary').click();
      await slot.locator('[data-testid="deck-image-file"]').setInputFiles({ name: "slide.png", mimeType: "image/png", buffer: slotPng });
      await slot.locator('[data-testid="deck-image-kind"]').selectOption("photo");
      await slot.locator('[data-testid="deck-image-send"]').click();
      await page.locator(`[data-testid="deck-slot"][data-slot-key="${key}"] [data-testid="deck-slot-filled"]`).waitFor({ timeout: 30000 });
    }
    must((await db.query.deckSlots.findMany({ where: eq(schema.deckSlots.webinarId, webinarId) })).filter((r) => slotKeys.includes(r.slotKey)).length === 2, "both slots hold their uploads, the second as the first");
    console.log(`✓ §6: the thumbnails load Montserrat and Playfair Display from Google, the CSP names exactly those hosts; uploads into two slots in a row both attach (${slotKeys.join(", ")})`);

    console.log("\nsmoke-firstdeck: all checks passed");
  } finally {
    await browser.close();
    for (const child of [ai, blob]) {
      try {
        process.kill(-child.pid!);
      } catch {
        /* already gone */
      }
    }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
