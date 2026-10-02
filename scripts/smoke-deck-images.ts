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
// The coach's uploads, made here at known sizes and flat colours so the file and the render can be read back against them
// (deck visuals §1): a wide photo (2:1), a wider screenshot (3:1) and a logo (3:1). The photo's blue is scanned for in the render.
const PHOTO_PX = { width: 1600, height: 800 };
const SHOT_PX = { width: 1200, height: 400 };
const LOGO_PX = { width: 300, height: 100 };
const PHOTO_RGB = { r: 46, g: 134, b: 222 };
/** A picture frame on the slide, inches (the engine's slotFrame for the cover; read back here, never retyped elsewhere). */
const COVER_FRAME = { x: 5.2, y: 0.9, w: 4.3, h: 3.85 };
const LOGO_BOX = { w: 0.9, h: 0.24 };
const within = (a: number, b: number, tol = 0.01) => Math.abs(a - b) / b <= tol;
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
    const { default: sharp } = await import("sharp");
    const flat = (px: { width: number; height: number }, rgb: { r: number; g: number; b: number }) => sharp({ create: { ...px, channels: 3, background: rgb } }).png().toBuffer();
    const PHOTO = await flat(PHOTO_PX, PHOTO_RGB);
    const SHOT = await flat(SHOT_PX, { r: 255, g: 106, b: 0 });
    const LOGO = await flat(LOGO_PX, { r: 30, g: 160, b: 80 });

    // ── The library: a photo needs no consent; a screenshot does. ──
    await page.goto(`${base}/images`);
    const addImage = async (kind: string, opts: { caption?: string; consentName?: string; consentTick?: boolean } = {}) => {
      await page.goto(`${base}/images`);
      await settle(page);
      await page.locator('[data-testid="deck-image-file"]').waitFor({ state: "attached" });
      await page.setInputFiles('[data-testid="deck-image-file"]', { name: `${kind}.png`, mimeType: "image/png", buffer: kind === "photo" ? PHOTO : kind === "screenshot" ? SHOT : LOGO });
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
    if (photos.length !== 1 || photos[0].consentTick || photos[0].mime !== "image/png" || photos[0].width !== PHOTO_PX.width || photos[0].height !== PHOTO_PX.height) throw new Error(`a photo is stored with no consent, sniffed and measured: ${JSON.stringify(photos[0])}`);
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
    if (!/red placeholder/.test(await slotsText())) throw new Error("the Deck step says an empty slot exports with a red placeholder (§2)");

    // ── §2, before any picture: the empty cover slot exports as a dashed frame with red text saying what to add, read off the
    //    XML and off LibreOffice's render (the red pixels span the frame). ──
    const { default: JSZip } = await import("jszip");
    const emptyRes = await page.request.get(`${base}/api/webinars/${webinar.id}/deck?format=pptx`);
    const emptyBody = await emptyRes.body();
    if (!emptyRes.ok()) throw new Error(`the deck exports with its slots empty: ${emptyRes.status()}`);
    const emptyZip = await JSZip.loadAsync(emptyBody);
    const emptyCover = await emptyZip.file("ppt/slides/slide1.xml")!.async("string");
    // The cover carries the logo (§4, top left) and nothing else before a picture is attached to its slot.
    if ((emptyCover.match(/<p:pic>/g) ?? []).length !== 1) throw new Error("before a picture is attached, the cover carries the logo and no other picture");
    if (!emptyCover.includes('<a:prstDash val="dash"/>') || !emptyCover.includes('<a:srgbClr val="D92D20"/>') || !emptyCover.includes("Add a photo of you: on stage, or on a call.")) throw new Error("the empty slot is a dashed frame with red text saying what to add");
    const dashed = boxes(emptyCover).find((b) => within(b.cx / EMU, COVER_FRAME.w) && within(b.cy / EMU, COVER_FRAME.h) && within(b.x / EMU, COVER_FRAME.x) && within(b.y / EMU, COVER_FRAME.y));
    if (!dashed) throw new Error(`the placeholder frame is the picture's frame: ${JSON.stringify(boxes(emptyCover))}`);
    const RED = { r: 0xd9, g: 0x2d, b: 0x20 };
    const dirEmpty = mkdtempSync(join(tmpdir(), "deck-empty-"));
    writeFileSync(join(dirEmpty, "deck.pptx"), emptyBody);
    await run("soffice", ["--headless", "--convert-to", "png", "--outdir", dirEmpty, join(dirEmpty, "deck.pptx")], { timeout: 120000, env: { ...process.env, HOME: dirEmpty } });
    const emptyPng = readdirSync(dirEmpty).find((f) => f.endsWith(".png"));
    if (!emptyPng) throw new Error("LibreOffice rendered the empty-slot cover to a PNG");
    const { data: rpx, info: rinfo } = await sharp(readFileSync(join(dirEmpty, emptyPng))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let rMinX = rinfo.width, rMaxX = -1, rMinY = rinfo.height, rMaxY = -1, reds = 0;
    for (let y = 0; y < rinfo.height; y++) {
      for (let x = 0; x < rinfo.width; x++) {
        const i = (y * rinfo.width + x) * 3;
        if (Math.abs(rpx[i] - RED.r) < 40 && Math.abs(rpx[i + 1] - RED.g) < 40 && Math.abs(rpx[i + 2] - RED.b) < 40) {
          reds++;
          if (x < rMinX) rMinX = x;
          if (x > rMaxX) rMaxX = x;
          if (y < rMinY) rMinY = y;
          if (y > rMaxY) rMaxY = y;
        }
      }
    }
    const redBox = { w: rMaxX - rMinX + 1, h: rMaxY - rMinY + 1 };
    if (reds < 200 || !within(redBox.w / rinfo.width, COVER_FRAME.w / 10, 0.03) || !within(redBox.h / rinfo.height, COVER_FRAME.h / 5.625, 0.03)) throw new Error(`the render paints the red placeholder across the picture's frame: ${JSON.stringify(redBox)} of ${rinfo.width}×${rinfo.height}, ${reds} red px`);
    console.log(`✓ §2: an empty slot exports as a dashed red frame with "Add a photo: …" in it, the picture's own frame on the XML and on the render (${redBox.w}×${redBox.h} px of ${rinfo.width}×${rinfo.height})`);
    await coverSlot.locator('[data-testid="deck-slot-picker"]').selectOption(photos[0].id);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), coverSlot.locator('[data-testid="deck-slot-attach"]').click()]);
    await settle(page);
    // The refreshed page lands a beat after the action's response: wait for the marker rather than reading once.
    if (!(await page.locator('[data-testid="deck-slot"][data-slot-key="cover:photo"] [data-testid="deck-slot-filled"]').waitFor({ timeout: 15000 }).then(() => true, () => false))) throw new Error("the cover slot shows a picture is attached");
    const slotRow = await db.query.deckSlots.findFirst({ where: and(eq(schema.deckSlots.webinarId, webinar.id), eq(schema.deckSlots.slotKey, "cover:photo")) });
    if (slotRow?.imageId !== photos[0].id) throw new Error("the slot points at the coach's chosen image");
    const emptyAfter = Number((await slotsText()).match(/^(\d+)/)?.[1] ?? "0");
    if (emptyAfter !== emptyBefore - 1) throw new Error(`filling one slot drops the empty count by one, ${emptyBefore}→${emptyAfter}`);
    console.log(`✓ a picture attached to the cover slot; the empty-slot count fell ${emptyBefore}→${emptyAfter}`);

    // ── The .pptx: the picture inside its frame, no text box off the slide, no construction language in the notes. ──
    const res = await page.request.get(`${base}/api/webinars/${webinar.id}/deck?format=pptx`);
    const body = await res.body();
    if (!res.ok() || body.subarray(0, 2).toString() !== "PK" || body.length < 5000) throw new Error(`the .pptx exports: ${res.status()} ${body.length} bytes`);
    const zip = await JSZip.loadAsync(body);
    const media = Object.keys(zip.files).filter((f) => /^ppt\/media\/image[-\d]+\.(png|jpe?g|gif|webp)$/.test(f));
    if (!media.length) throw new Error("the coach's picture is embedded in the file");
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    if (!/<p:pic>/.test(slide1)) throw new Error("the cover slide carries the picture");
    if (slide1.includes('<a:srgbClr val="D92D20"/>') || slide1.includes("Add a photo of you")) throw new Error("once the slot is filled, the placeholder is gone and the picture sits in its frame");
    for (const b of boxes(slide1)) {
      if (b.x < 0 || b.y < 0 || b.x + b.cx > SLIDE_W + 1 || b.y + b.cy > SLIDE_H + 1) throw new Error(`a box on the cover runs off the slide: ${JSON.stringify(b)}`);
    }
    console.log(`✓ the .pptx embeds the picture (${media[0]}); every picture and text box on the cover sits inside the slide`);

    // ── Deck visuals §1, read off the XML: every placed picture's drawn box has the ratio of what it shows (its crop box when
    //    covered, its whole self when contained), within 1%; the bytes are downscaled and re-encoded; one media file per picture. ──
    type Pic = { slide: string; media: string; cx: number; cy: number; crop: { l: number; r: number; t: number; b: number } | null };
    const picsIn = async (z: InstanceType<typeof JSZip>): Promise<Pic[]> => {
      const out: Pic[] = [];
      for (const f of Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
        const xml = await z.file(f)!.async("string");
        const rels = await z.file(f.replace("slides/", "slides/_rels/") + ".rels")!.async("string");
        const target = (rId: string) => rels.match(new RegExp(`Id="${rId}"[^>]*Target="\\.\\./media/([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="\\.\\./media/([^"]+)"[^>]*Id="${rId}"`))?.[1] ?? "";
        const re = /<p:pic>([\s\S]*?)<\/p:pic>/g;
        for (let m = re.exec(xml); m; m = re.exec(xml)) {
          const pic = m[1];
          const rId = pic.match(/r:embed="(rId\d+)"/)![1];
          const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)!;
          const sr = pic.match(/<a:srcRect l="(-?\d+)" r="(-?\d+)" t="(-?\d+)" b="(-?\d+)"\/>/);
          out.push({ slide: f, media: `ppt/media/${target(rId)}`, cx: Number(ext[1]), cy: Number(ext[2]), crop: sr ? { l: Number(sr[1]) / 1e5, r: Number(sr[2]) / 1e5, t: Number(sr[3]) / 1e5, b: Number(sr[4]) / 1e5 } : null });
        }
      }
      return out;
    };
    const nativeOf = async (z: InstanceType<typeof JSZip>, name: string) => {
      const buf = await z.file(name)!.async("nodebuffer");
      const meta = await sharp(buf).metadata();
      return { width: meta.width!, height: meta.height!, format: meta.format!, bytes: buf.length };
    };
    const checkPics = async (z: InstanceType<typeof JSZip>, label: string) => {
      const pics = await picsIn(z);
      if (!pics.length) throw new Error(`${label}: there are pictures to check`);
      for (const p of pics) {
        const n = await nativeOf(z, p.media);
        const shown = p.crop ? { w: n.width * (1 - p.crop.l - p.crop.r), h: n.height * (1 - p.crop.t - p.crop.b) } : { w: n.width, h: n.height };
        if (p.crop && (p.crop.l < 0 || p.crop.r < 0 || p.crop.t < 0 || p.crop.b < 0)) throw new Error(`${label}: a crop never pads (negative srcRect) on ${p.slide}: ${JSON.stringify(p.crop)}`);
        if (!within(p.cx / p.cy, shown.w / shown.h)) throw new Error(`${label}: the drawn box on ${p.slide} (${(p.cx / p.cy).toFixed(3)}) must have the ratio of what it shows (${(shown.w / shown.h).toFixed(3)}, ${p.crop ? "cropped" : "whole"}): never stretched`);
      }
      return pics;
    };
    const pics1 = await checkPics(zip, "photo on the cover");
    // The cover's slot picture is the one in the frame; the cover's logo (§4) is the small one top left.
    const coverPics = pics1.filter((p) => p.slide === "ppt/slides/slide1.xml");
    const coverPic = coverPics.find((p) => within(p.cx / EMU, COVER_FRAME.w))!;
    const coverLogo = coverPics.find((p) => p !== coverPic)!;
    if (coverPics.length !== 2 || !coverLogo || coverLogo.crop || !within(coverLogo.cx / coverLogo.cy, LOGO_PX.width / LOGO_PX.height) || coverLogo.cy / EMU > 0.55 + 1e-3) throw new Error(`the cover carries the photo in its frame and the logo whole, top left: ${JSON.stringify(coverPics)}`);
    const coverNative = await nativeOf(zip, coverPic.media);
    // A photo covers its frame: the box is the frame, the crop is left and right only (a 2:1 photo in a 1.12:1 frame), centred.
    if (!within(coverPic.cx / EMU, COVER_FRAME.w) || !within(coverPic.cy / EMU, COVER_FRAME.h)) throw new Error(`the photo fills the cover's frame: ${coverPic.cx / EMU} by ${coverPic.cy / EMU} in`);
    if (!coverPic.crop || coverPic.crop.l <= 0 || coverPic.crop.l !== coverPic.crop.r || coverPic.crop.t !== 0 || coverPic.crop.b !== 0) throw new Error(`a wide photo is cropped equally left and right, never top and bottom: ${JSON.stringify(coverPic.crop)}`);
    // The bytes: a photo goes in as a JPEG, downscaled to cover twice the frame's 96 dpi size (826 by 739 px), never enlarged.
    const coverPlan = { w: Math.round(COVER_FRAME.w * 96 * 2), h: Math.round(COVER_FRAME.h * 96 * 2) };
    if (coverNative.format !== "jpeg" || coverNative.height !== coverPlan.h || coverNative.width !== Math.round((coverPlan.h * PHOTO_PX.width) / PHOTO_PX.height)) throw new Error(`the photo is embedded as a JPEG downscaled to cover ${coverPlan.w}×${coverPlan.h}: ${JSON.stringify(coverNative)}`);
    // The logo (3:1) sits whole inside its 0.9 by 0.24 in box, never stretched, as a PNG; on every content slide, and one media file for all of them.
    const logoPics = pics1.filter((p) => p.slide !== "ppt/slides/slide1.xml");
    const contentSlideCount = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length - 1;
    if (logoPics.length !== contentSlideCount || logoPics.length < 2) throw new Error(`the logo is on every one of the ${contentSlideCount} content slides: ${logoPics.length}`);
    for (const p of logoPics) {
      if (p.crop || !within(p.cx / p.cy, LOGO_PX.width / LOGO_PX.height) || p.cx / EMU > LOGO_BOX.w + 1e-3 || p.cy / EMU > LOGO_BOX.h + 1e-3) throw new Error(`the logo is contained whole inside its box: ${JSON.stringify(p)}`);
    }
    const logoNative = await nativeOf(zip, logoPics[0].media);
    if (logoNative.format !== "png" || new Set(logoPics.map((p) => p.media)).size !== 1) throw new Error(`the logo is one PNG media file shared by every slide: ${JSON.stringify([...new Set(logoPics.map((p) => p.media))])}`);
    if (media.length !== 3) throw new Error(`the photo, the cover's logo and the footer's logo (two sizes of one file) are three media files, whatever the slide count: ${media.join(", ")}`);
    if (body.length > 3 * 1024 * 1024) throw new Error(`the deck stays small: ${body.length} bytes`);
    console.log(`✓ §1 off the XML: the photo covers the cover's frame, cropped left and right only, as a ${coverNative.width}×${coverNative.height} JPEG; the logo is whole in its box on ${logoPics.length} slides as one PNG and on the cover (§4); ${media.length} media files, ${Math.round(body.length / 1024)}KB`);

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
    // §1 off the render: the cover as LibreOffice draws it (its PNG export is the first slide). The photo's flat blue is found
    // by its pixels; the painted box has the frame's ratio and width, within 2%: cropped to the frame, not squeezed into it.
    await run("soffice", ["--headless", "--convert-to", "png", "--outdir", dir, pptxPath], { timeout: 120000, env: { ...process.env, HOME: dir } });
    const pngName = readdirSync(dir).find((f) => f.endsWith(".png"));
    if (!pngName) throw new Error("LibreOffice rendered the cover to a PNG");
    const { data: px, info } = await sharp(readFileSync(join(dir, pngName))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, maxX = -1, minY = info.height, maxY = -1, hits = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        if (Math.abs(px[i] - PHOTO_RGB.r) < 24 && Math.abs(px[i + 1] - PHOTO_RGB.g) < 24 && Math.abs(px[i + 2] - PHOTO_RGB.b) < 24) {
          hits++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const painted = { w: maxX - minX + 1, h: maxY - minY + 1 };
    if (hits < 1000 || !within(painted.w / painted.h, COVER_FRAME.w / COVER_FRAME.h, 0.02) || !within(painted.w / info.width, COVER_FRAME.w / 10, 0.02)) throw new Error(`the rendered cover paints the photo in its frame's shape (${(COVER_FRAME.w / COVER_FRAME.h).toFixed(3)}, ${(COVER_FRAME.w / 10).toFixed(3)} of the width): ${painted.w}×${painted.h} of ${info.width}×${info.height}, ${hits} px`);
    console.log(`✓ §1 off the render: LibreOffice paints the photo at ${painted.w}×${painted.h} px of a ${info.width}-wide cover, the frame's own shape`);

    // ── A screenshot on the same slot is contained: whole, its own 3:1 ratio, the frame's full width, no crop. ──
    await page.goto(`${base}/webinars/${webinar.id}?step=deck`);
    const coverSlot2 = page.locator('[data-testid="deck-slot"][data-slot-key="cover:photo"]');
    await coverSlot2.locator('[data-testid="deck-slot-clear"]').waitFor({ timeout: 20000 });
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), coverSlot2.locator('[data-testid="deck-slot-clear"]').click()]);
    await settle(page);
    await page.goto(`${base}/webinars/${webinar.id}?step=deck`);
    await coverSlot2.locator('[data-testid="deck-slot-picker"]').waitFor({ timeout: 20000 });
    await coverSlot2.locator('[data-testid="deck-slot-picker"]').selectOption(shots[0].id);
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), coverSlot2.locator('[data-testid="deck-slot-attach"]').click()]);
    await settle(page);
    const res2 = await page.request.get(`${base}/api/webinars/${webinar.id}/deck?format=pptx`);
    const zip2 = await JSZip.loadAsync(await res2.body());
    const pics2 = await checkPics(zip2, "screenshot on the cover");
    const shotPic = pics2.filter((p) => p.slide === "ppt/slides/slide1.xml").find((p) => within(p.cx / EMU, COVER_FRAME.w))!;
    const shotNative = await nativeOf(zip2, shotPic.media);
    if (shotPic.crop || !within(shotPic.cx / EMU, COVER_FRAME.w) || !within(shotPic.cx / shotPic.cy, SHOT_PX.width / SHOT_PX.height) || shotPic.cy > shotPic.cx) throw new Error(`a screenshot is contained whole at its own ratio across the frame's width, never cropped: ${JSON.stringify(shotPic)}`);
    if (shotNative.format !== "png" || shotNative.width !== Math.round(COVER_FRAME.w * 96 * 2) || shotNative.width >= SHOT_PX.width) throw new Error(`a screenshot stays a PNG, downscaled to fit twice the frame's 96 dpi width: ${JSON.stringify(shotNative)}`);
    console.log(`✓ §1 contain: a screenshot on the cover is whole at 3:1 across the frame's width, no crop, a ${shotNative.width}×${shotNative.height} PNG`);

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
