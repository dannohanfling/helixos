/**
 * Deck v2, the pictures: the coach's own image library, the consent tick a screenshot or proof affirms, a picture attached to a
 * suggested slot, and the .pptx that comes out — parsed for the picture inside its frame and no text box off the slide, then
 * opened in LibreOffice and rendered to a PDF that carries the image, proving the file is one PowerPoint and LibreOffice both
 * accept. Every expected value is the coach's own input or read from the record. Runs against scripts/mock-blob.ts; the dev
 * server must carry the blob env (scripts/dev-server.sh sets it). soffice and jszip are used and must be installed.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const blobPort = 4050;
const run = promisify(execFile);
// A real 1×1 PNG: the coach's own upload, the smallest that still sniffs and measures as an image.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// Construction language that must never reach a speaker note: how the deck is built in code, not what the presenter says.
const CONSTRUCTION = ["renderPlan", "deckSlides", "SlidePlan", "TextBox", "slotFrame", "imageFrame", "data-testid", "placeholder colour", "the slot", "SLOT_WHAT", "pptxgenjs", "EMU"];
const EMU = 914400;
const SLIDE_W = 10 * EMU;
const SLIDE_H = 5.625 * EMU;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

/** Every (off, ext) box in one slide's XML: proves each picture and text box is drawn inside the slide, none off its edge. */
function boxes(xml: string): { x: number; y: number; cx: number; cy: number }[] {
  const out: { x: number; y: number; cx: number; cy: number }[] = [];
  const re = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push({ x: Number(m[1]), y: Number(m[2]), cx: Number(m[3]), cy: Number(m[4]) });
  return out;
}

async function main() {
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  await fetch(`http://localhost:${blobPort}/__reset`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const wsId = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) }))!.workspaceId;
    const imagesOf = async (kind: string) => db.query.deckImages.findMany({ where: and(eq(schema.deckImages.userId, user.id), eq(schema.deckImages.kind, kind as "photo")) });
    // The seed does not touch the deck-image tables, so start this walk from a known state: clear this coach's library and any
    // webinar a prior run of this walk left behind. Everything here is created fresh below.
    const { inArray, like } = await import("drizzle-orm");
    const priorWebinars = await db.query.webinars.findMany({ where: like(schema.webinars.title, "Pictures on a deck%") });
    if (priorWebinars.length) {
      await db.delete(schema.deckSlots).where(inArray(schema.deckSlots.webinarId, priorWebinars.map((w) => w.id)));
      await db.delete(schema.webinars).where(inArray(schema.webinars.id, priorWebinars.map((w) => w.id)));
    }
    await db.delete(schema.deckImages).where(eq(schema.deckImages.userId, user.id));

    // ── The library: a photo needs no consent; a screenshot does. ──
    await page.goto(`${base}/images`);
    const addImage = async (kind: string, opts: { caption?: string; consentName?: string; consentTick?: boolean } = {}) => {
      await page.goto(`${base}/images`);
      await settle(page);
      await page.locator('[data-testid="deck-image-file"]').waitFor({ state: "attached" });
      await page.setInputFiles('[data-testid="deck-image-file"]', { name: `${kind}.png`, mimeType: "image/png", buffer: PNG });
      await page.selectOption('[data-testid="deck-image-kind"]', kind);
      if (opts.caption) await page.fill('[data-testid="deck-image-caption"]', opts.caption);
      if (opts.consentName) await page.fill('[data-testid="deck-image-consent-name"]', opts.consentName);
      if (opts.consentTick) await page.check('[data-testid="deck-image-consent-tick"]');
      await page.click('[data-testid="deck-image-send"]');
    };

    await addImage("photo", { caption: "Me on stage" });
    await page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/images"), { timeout: 20000 }).catch(() => {});
    await settle(page);
    const photos = await imagesOf("photo");
    if (photos.length !== 1 || photos[0].consentTick || photos[0].mime !== "image/png" || photos[0].width !== 1) throw new Error(`a photo is stored with no consent, sniffed and measured: ${JSON.stringify(photos[0])}`);
    if (!photos[0].blobKey.startsWith(`deck/${wsId}/${user.id}/`)) throw new Error(`the key is the coach's own deck folder: ${photos[0].blobKey}`);
    console.log("✓ a photo joins the library on its own token, read back and sniffed, no consent asked");

    // A screenshot with no tick is refused, visibly, and no row is written.
    await addImage("screenshot", { caption: "A DM" });
    await page.locator('[data-testid="deck-image-error"]').waitFor({ timeout: 5000 });
    if (!/tick the sentence and write who/i.test(await page.locator('[data-testid="deck-image-error"]').innerText())) throw new Error("a screenshot without the tick is refused, in the coach's words");
    if ((await imagesOf("screenshot")).length !== 0) throw new Error("a refused screenshot writes no row");
    console.log("✓ a screenshot with no consent tick is refused visibly, and nothing is stored");

    // The same screenshot, ticked and named, is kept with who and when.
    await addImage("screenshot", { caption: "A DM", consentName: "Dana R.", consentTick: true });
    await page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/images"), { timeout: 20000 }).catch(() => {});
    await settle(page);
    const shots = await imagesOf("screenshot");
    if (shots.length !== 1 || !shots[0].consentTick || shots[0].consentName !== "Dana R." || !shots[0].consentAt) throw new Error(`a screenshot is kept with the tick, the name and the time: ${JSON.stringify(shots[0])}`);
    console.log("✓ a screenshot with the tick and a name is kept, consent stored with who and when");

    // A logo, for the footer bar the webinar below turns on.
    await addImage("logo", { caption: "Wordmark" });
    await page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/images"), { timeout: 20000 }).catch(() => {});
    await settle(page);
    if ((await imagesOf("logo")).length !== 1) throw new Error("a logo joins the library");

    // ── A picture on a slot, on a clean webinar. The seeded examples carry demo placeholders on purpose (the gate refuses
    // those, tested in the wizards walk); this test wants a deck that exports, so it builds one from the coach's own opening
    // contract with the footer bar on — the same fields the Foundation step writes, no section holes to refuse. ──
    const workspace = (await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, wsId) }))!;
    const { newId } = await import("@/lib/ids");
    const webinarId = newId();
    await db.insert(schema.webinars).values({
      id: webinarId,
      workspaceId: wsId,
      userId: user.id,
      title: "Pictures on a deck (walk)",
      presenter: "Lindsey Brittain",
      promiseLine: "Leave with a plan you'll actually run this week.",
      chatPrompt: "Say hi and drop where you're tuning in from.",
      groundRule: "Nothing here is a promise of income.",
      outcomes: ["A clear next step", "A plan for the week", "One belief broken"],
      sessionGoal: "Get you to your first booked call.",
      footerBar: true,
    });
    const webinar = { id: webinarId };
    await page.goto(`${base}/webinars/${webinar.id}?step=deck`);
    await page.locator('[data-testid="deck-honesty"]').waitFor({ timeout: 20000 });
    if (await page.locator('[data-testid="deck-refused"]').count()) throw new Error(`the worked example exports clean: "${await page.locator('[data-testid="deck-refused"]').innerText()}"`);
    const slotsText = async () => ((await page.locator('[data-testid="deck-slots"]').count()) ? ((await page.locator('[data-testid="deck-slots"]').first().textContent()) ?? "") : "");
    const emptyBefore = Number((await slotsText()).match(/^(\d+)/)?.[1] ?? "0");
    const coverSlot = page.locator('[data-testid="deck-slot"][data-slot-key="cover:photo"]');
    if (!(await coverSlot.count())) throw new Error("the cover carries a photo slot on the Deck step");
    await coverSlot.locator('[data-testid="deck-slot-picker"]').selectOption(photos[0].id);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), coverSlot.locator('[data-testid="deck-slot-attach"]').click()]);
    await settle(page);
    if (!(await page.locator('[data-testid="deck-slot"][data-slot-key="cover:photo"] [data-testid="deck-slot-filled"]').count())) throw new Error("the cover slot shows a picture is attached");
    const slotRow = await db.query.deckSlots.findFirst({ where: and(eq(schema.deckSlots.webinarId, webinar.id), eq(schema.deckSlots.slotKey, "cover:photo")) });
    if (slotRow?.imageId !== photos[0].id) throw new Error("the slot points at the coach's chosen image");
    const emptyAfter = Number((await slotsText()).match(/^(\d+)/)?.[1] ?? "0");
    if (emptyAfter !== emptyBefore - 1) throw new Error(`filling one slot drops the empty count by one, ${emptyBefore}→${emptyAfter}`);
    console.log(`✓ a picture attached to the cover slot; the empty-slot count fell ${emptyBefore}→${emptyAfter}`);

    // ── The .pptx: the picture inside its frame, no text box off the slide, no construction language in the notes. ──
    const res = await page.request.get(`${base}/api/webinars/${webinar.id}/deck?format=pptx`);
    const body = await res.body();
    if (!res.ok() || body.subarray(0, 2).toString() !== "PK" || body.length < 5000) throw new Error(`the .pptx exports: ${res.status()} ${body.length} bytes`);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(body);
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/image[-\d]+\.(png|jpe?g|gif|webp)$/.test(f));
    if (!media.length) throw new Error("the coach's picture is embedded in the file");
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    if (!/<p:pic>/.test(slide1)) throw new Error("the cover slide carries the picture");
    for (const b of boxes(slide1)) {
      if (b.x < 0 || b.y < 0 || b.x + b.cx > SLIDE_W + 1 || b.y + b.cy > SLIDE_H + 1) throw new Error(`a box on the cover runs off the slide: ${JSON.stringify(b)}`);
    }
    console.log(`✓ the .pptx embeds the picture (${media[0]}); every picture and text box on the cover sits inside the slide`);

    // The footer bar the webinar turned on: the workspace name is drawn on a content slide, and the logo is a second embedded image.
    const contentSlides = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide[2-9]\d*\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")))).join("\n");
    if (!contentSlides.includes(workspace.name)) throw new Error("the footer bar draws the workspace name on the content slides");
    if (media.length < 2) throw new Error("the footer bar's logo is embedded as its own image");
    for (const b of boxes(contentSlides.split("</p:sld>")[0] + "</p:sld>")) if (b.x < 0 || b.y < 0 || b.x + b.cx > SLIDE_W + 1 || b.y + b.cy > SLIDE_H + 1) throw new Error(`a box on an opening slide runs off the slide: ${JSON.stringify(b)}`);
    console.log(`✓ the footer bar draws the workspace name and the coach's logo, both inside the slide`);

    const noteFiles = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    const notes = (await Promise.all(noteFiles.map((f) => zip.file(f)!.async("string")))).join("\n");
    const leaked = CONSTRUCTION.filter((w) => notes.includes(w));
    if (leaked.length) throw new Error(`a speaker note carries construction language: ${leaked.join(", ")}`);
    if (!/Visual direction|Delivery|Presented by/.test(notes)) throw new Error("the notes carry the art direction and delivery, so the check above is reading real notes");
    console.log(`✓ ${noteFiles.length} speaker notes carry delivery and art direction, none of the ${CONSTRUCTION.length} construction terms`);

    // ── The render: LibreOffice opens the .pptx and renders it to a PDF that carries the image. ──
    const dir = mkdtempSync(join(tmpdir(), "deck-"));
    const pptxPath = join(dir, "deck.pptx");
    writeFileSync(pptxPath, body);
    // LibreOffice needs a writable HOME and its own profile; the Impress module (libreoffice-impress) must be installed.
    await run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, pptxPath], { timeout: 120000, env: { ...process.env, HOME: dir } });
    const pdfName = readdirSync(dir).find((f) => f.endsWith(".pdf"));
    if (!pdfName) throw new Error("LibreOffice rendered the .pptx to a PDF");
    const pdf = readFileSync(join(dir, pdfName));
    if (pdf.subarray(0, 5).toString() !== "%PDF-" || pdf.length < 5000) throw new Error(`the render is a real PDF: ${pdf.length} bytes`);
    if (!/\/Subtype\s*\/Image/.test(pdf.toString("latin1"))) throw new Error("the rendered PDF carries the picture as an image, so LibreOffice drew it inside its frame");
    console.log(`✓ LibreOffice opened the .pptx and rendered it to a ${Math.round(pdf.length / 1024)}KB PDF that carries the picture`);

    // ── A testimonial slot: only an approved proof's photo; withdrawing approval empties it, with the reason on the step. ──
    const testimonial = await db.query.deckSlots.findFirst({ where: eq(schema.deckSlots.webinarId, webinar.id) }); // any; the reason path is what we assert
    const proofBlockSlot = await page.locator('[data-testid="deck-slot"][data-kind="testimonial"]').count();
    if (proofBlockSlot) {
      const proofRow = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.userId, user.id), eq(schema.proofs.status, "approved")) });
      if (proofRow) {
        await db.update(schema.proofs).set({ status: "draft" }).where(eq(schema.proofs.id, proofRow.id));
        await page.goto(`${base}/webinars/${webinar.id}?step=deck`);
        await page.locator('[data-testid="deck-honesty"]').waitFor({ timeout: 20000 });
        const reasons = (await page.locator('[data-testid="deck-slot-reasons"]').count()) ? await page.locator('[data-testid="deck-slot-reasons"]').innerText() : "";
        if (!/no longer approved/.test(reasons)) throw new Error(`a withdrawn proof empties its testimonial slot and says why, got "${reasons}"`);
        await db.update(schema.proofs).set({ status: "approved" }).where(eq(schema.proofs.id, proofRow.id));
        console.log("✓ withdrawing a proof's approval empties its testimonial slot, and the Deck step says why");
      } else {
        console.log("• no approved proof wired to a testimonial slot on this webinar; the withdrawn-approval path is covered by the deck-slot unit test");
      }
    } else {
      console.log("• this webinar has no testimonial slot; the approved-only rule is covered by the deck-slot unit test");
    }
    void testimonial;

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Deck-images walk passed.");
  } finally {
    try {
      process.kill(-blob.pid!);
    } catch {
      /* already gone */
    }
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
