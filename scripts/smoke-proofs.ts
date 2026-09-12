/**
 * Proof attachments: a file joins a proof from the browser straight into the PRIVATE store on a token minted from that
 * store's own token; the server reads it back and sniffs it before a row exists (a page disguised as a .jpg is refused and
 * not stored); the two questions and the own-screen tick are asked at upload; a person without recorded permission holds
 * approval (the same gate, extended) until the likeness sentence is ticked with a name; the read route wants a session, honours
 * Range, never lets a CDN cache, and records bytes served; the object is in the proof store with private access and never in
 * the public store; deleting deletes the object first; a result-showing image inherits the typed-dollar block in the composer;
 * Settings shows the quota. Runs against scripts/mock-blob.ts; the dev server must be started with BLOB_READ_WRITE_TOKEN,
 * PROOF_BLOB_READ_WRITE_TOKEN and VERCEL_BLOB_API_URL / NEXT_PUBLIC_VERCEL_BLOB_API_URL at http://localhost:4050
 * (scripts/dev-server.sh sets all of them).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const blobPort = 4050;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
const anon = (url: string, init: RequestInit = {}) => fetch(url, { redirect: "manual", ...init });
type Listed = { objects: { pathname: string; access: string; store: string; size: number }[] };
const listed = async (): Promise<Listed["objects"]> => ((await (await fetch(`http://localhost:${blobPort}/__list`)).json()) as Listed).objects;
// A real PNG (1×1) and a web page wearing a .jpg name.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const HEIC = readFileSync(join(__dirname, "..", "src", "lib", "engine", "__tests__", "fixtures", "tiny.heic"));
const FAKE_JPG = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");

async function main() {
  const blob = spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  await fetch(`http://localhost:${blobPort}/__reset`);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");

    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;

    // A fresh proof to hang files on
    await page.goto(`${base}/proof`);
    await page.fill('input[name="name"]', "Dana R.: 4 clients in 30 days");
    await submit(page, 'button:has-text("Save proof")');
    await page.waitForURL(/\/proof\/[a-z0-9-]+$/i);
    const proofId = page.url().split("/").pop()!;
    await expectText(page, "Nothing attached yet", "empty attachments");
    if (!(await page.locator('[data-testid="proof-upload"]').count())) throw new Error("the uploader is on the page when the proof store is configured");

    // Upload: a PNG that shows a result and a person, with the own-screen tick, and no permission recorded yet
    // A file change fired before React has hydrated the input is lost: wait for the page to settle first.
    const settled = async () => {
      await page.locator('[data-testid="proof-upload"]').waitFor({ timeout: 15000 });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(300);
    };
    const upload = async (file: { name: string; mimeType: string; buffer: Buffer }, answers: { result: "yes" | "no"; person: "yes" | "no"; consentName?: string; consentTick?: boolean; ownScreen?: boolean; alt?: string }) => {
      await settled();
      await page.setInputFiles('[data-testid="proof-file"]', file);
      await page.click(`[data-testid="result-${answers.result}"]`);
      await page.click(`[data-testid="person-${answers.person}"]`);
      if (answers.person === "yes" && answers.consentName) await page.fill('[data-testid="consent-name"]', answers.consentName);
      if (answers.consentTick) await page.check('[data-testid="consent-tick"]');
      if (answers.ownScreen !== false && (await page.locator('[data-testid="own-screen-tick"]').count())) await page.check('[data-testid="own-screen-tick"]');
      if (answers.alt) await page.fill('[data-testid="alt-text"]', answers.alt);
      await page.click('[data-testid="proof-upload-send"]');
    };
    await upload({ name: "stripe-march.png", mimeType: "image/png", buffer: PNG }, { result: "yes", person: "yes", consentName: "Dana R.", consentTick: false });
    await page.waitForURL(/attached=1/, { timeout: 20000 });
    await expectText(page, "Attached.", "attached banner");
    const att1 = page.locator('[data-testid="attachment"]').first();
    if ((await att1.getAttribute("data-kind")) !== "image" || (await att1.getAttribute("data-result")) !== "1" || (await att1.getAttribute("data-person")) !== "1" || (await att1.getAttribute("data-consent")) !== "open") throw new Error("the row carries the sniffed kind and both answers, with the permission still open");
    const rows = await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId) });
    if (rows.length !== 1 || rows[0].mime !== "image/png" || rows[0].bytes !== PNG.length || rows[0].width !== 1 || rows[0].height !== 1 || !rows[0].ownScreenAt || rows[0].consentRecordedAt) throw new Error(`the record is what the server read and sniffed: ${JSON.stringify(rows[0])}`);
    const key = rows[0].blobKey;
    if (!key.startsWith(`proofs/${rows[0].workspaceId}/${proofId}/`) || !/\.png$/.test(key)) throw new Error(`the key is the client's own tree: ${key}`);
    const stored = (await listed()).find((o) => o.pathname === key);
    if (!stored || stored.access !== "private" || !/PROOF/i.test(stored.store)) throw new Error(`the object is in the proof store, private: ${JSON.stringify(stored)}`);
    if ((await listed()).some((o) => o.pathname.startsWith("proofs/") && !/PROOF/i.test(o.store))) throw new Error("a proof object landed in the public store");
    console.log("✓ upload: browser to the private store on its own token, read back and sniffed, both questions recorded, own-screen tick recorded");

    // The read route: session required, membership checked, Range honoured, never cached, bytes served recorded
    const readUrl = `${base}/api/proofs/attachments/${rows[0].id}`;
    const anonRead = await anon(readUrl);
    // The proxy sends a stranger to the login page before the handler's own 401 can run; either way, not one byte.
    if (![401, 302, 303, 307].includes(anonRead.status) || (anonRead.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`an anonymous read must be refused: ${anonRead.status}`);
    if ((await anon(`http://localhost:${blobPort}/private/${key}`)).status !== 403) throw new Error("the store itself refuses a private object without the token");
    const okRead = await page.request.get(readUrl);
    if (okRead.status() !== 200 || okRead.headers()["content-type"] !== "image/png" || okRead.headers()["cache-control"] !== "private, no-store") throw new Error(`signed-in read: ${okRead.status()} ${okRead.headers()["content-type"]} ${okRead.headers()["cache-control"]}`);
    if (Buffer.compare(await okRead.body(), PNG) !== 0) throw new Error("the bytes served are the bytes stored");
    const ranged = await page.request.get(readUrl, { headers: { range: "bytes=0-9" } });
    if (ranged.status() !== 206 || (await ranged.body()).length !== 10 || !ranged.headers()["content-range"]) throw new Error(`a Range read is a 206 with ten bytes: ${ranged.status()}`);
    // The bytes are recorded once the stream has flushed, after the response is complete, so the rows land a moment after the
    // reads return; and the server's insert can hold the file while this process asks. Wait for both reads to be recorded.
    const readsRecorded = async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const rowsNow = await db.query.proofAttachmentReads.findMany({ where: eq(schema.proofAttachmentReads.attachmentId, rows[0].id) });
          if (rowsNow.some((r) => r.bytes === 10) && rowsNow.some((r) => r.bytes === PNG.length)) return rowsNow;
        } catch (e) {
          // The lock is named on the cause, two levels down from Drizzle's wrapper.
          const chain = [e, (e as { cause?: unknown }).cause, ((e as { cause?: { cause?: unknown } }).cause ?? {})["cause"]].map((x) => (x instanceof Error ? x.message : String(x ?? ""))).join(" ");
          if (!/SQLITE_BUSY|database is locked/.test(chain)) throw e;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return db.query.proofAttachmentReads.findMany({ where: eq(schema.proofAttachmentReads.attachmentId, rows[0].id) });
    };
    const served = await readsRecorded();
    // The page's own thumbnail fetches count too: every read is a whole read or the ten-byte range, and both appear.
    if (!served.some((r) => r.bytes === 10) || !served.some((r) => r.bytes === PNG.length) || !served.every((r) => r.bytes === 10 || r.bytes === PNG.length)) throw new Error(`every read records its bytes: ${JSON.stringify(served)}`);
    console.log("✓ read route: 401 anonymous, 403 at the store, 200 with no-store for the member, 206 on Range, bytes served recorded");

    // A page wearing a .jpg name is refused by its bytes before any of them move, and never reaches the store (the server sniffs again on record; that path is unit-tested)
    await page.goto(`${base}/proof/${proofId}`);
    await settled();
    await page.setInputFiles('[data-testid="proof-file"]', { name: "totally-a-photo.jpg", mimeType: "image/jpeg", buffer: FAKE_JPG });
    await page.locator('[data-testid="proof-upload-error"]').waitFor({ timeout: 10000 });
    await expectText(page, "web page or a vector graphic", "markup refused");
    if (await page.locator('[data-testid="proof-questions"]').count()) throw new Error("a refused file gets no questions");
    if ((await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId) })).length !== 1) throw new Error("the refused file got a row");
    if ((await listed()).some((o) => o.pathname.startsWith(`proofs/`) && o.pathname !== key)) throw new Error("the refused file reached the store");
    console.log("✓ a web page disguised as a .jpg is refused by its bytes in the browser and never reaches the store");

    // The gate, extended: approval is held while the person's permission is unrecorded; recording it opens the gate
    await page.goto(`${base}/proof/${proofId}`);
    await page.check('[data-testid="permission-tick"] input');
    await submit(page, '[data-testid="approve"]');
    await page.waitForURL(/needsAttachmentConsent=1/);
    await expectText(page, "One attachment shows a person and has no permission recorded yet", "approval held");
    if ((await db.query.proofs.findFirst({ where: eq(schema.proofs.id, proofId) }))?.status !== "draft") throw new Error("the proof was approved past an open permission");
    await page.fill('[data-testid="attachment-consent-name"]', "Dana R.");
    await page.check('[data-testid="attachment-consent-tick"]');
    await submit(page, '[data-testid="attachment-consent-save"]');
    await expectText(page, "Dana R. has given me permission to use this photo of them in my marketing.", "likeness sentence recorded");
    await page.check('[data-testid="permission-tick"] input');
    await submit(page, '[data-testid="approve"]');
    await page.waitForURL(new RegExp(`/proof/${proofId}$`));
    if ((await db.query.proofs.findFirst({ where: eq(schema.proofs.id, proofId) }))?.status !== "approved") throw new Error("approval should pass once the permission is recorded");
    console.log("✓ the same gate, extended: held with the sentence, open once the likeness permission is recorded with a name");

    // An approved proof cannot take a person without their permission recorded there and then: the gate is not walked around
    await upload({ name: "dana-face.png", mimeType: "image/png", buffer: PNG }, { result: "no", person: "yes", consentName: "Dana R.", consentTick: false });
    await page.locator('[data-testid="proof-upload-error"]').waitFor({ timeout: 20000 });
    await expectText(page, "already approved, so a person in a file needs their permission recorded now", "approved proof refuses an open permission");
    if (/answer no/i.test(await page.locator('[data-testid="proof-upload-error"]').innerText())) throw new Error("the refusal must not suggest re-answering the question");
    if ((await listed()).filter((o) => o.pathname.startsWith("proofs/")).length !== 1) throw new Error("the refused file stayed in the store");
    await page.goto(`${base}/proof/${proofId}`);
    console.log("✓ an approved proof refuses a person without permission recorded at upload; the object is gone");

    // A second file with no person: alt text, the thumbnail order, the copy-out downloads
    await upload({ name: "before-after.png", mimeType: "image/png", buffer: PNG }, { result: "no", person: "no", alt: "Dana's calendar, four discovery calls booked" });
    await page.waitForURL(/attached=1/, { timeout: 20000 });
    if ((await page.locator('[data-testid="attachment"]').count()) !== 2) throw new Error("two attachments");
    await submit(page, '[data-testid="attachment-first"]');
    const first = await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId), orderBy: (t, { asc }) => [asc(t.sortOrder)] });
    if (first[0].originalFilename !== "before-after.png") throw new Error("moving one first makes it the thumbnail");
    if ((await page.locator('[data-testid="copy-out-files"] a').count()) !== 2) throw new Error("a download per attachment beside the copy-quote buttons");
    console.log("✓ order and copy-out: the first is the thumbnail, downloads beside the quote");

    // A real HEIC, the iPhone's default, end to end: stored as sent, a JPEG rendition beside it that the page shows and
    // the quota counts, the original on download; deleted, both objects go
    await page.goto(`${base}/proof/${proofId}`);
    await upload({ name: "IMG_0412.heic", mimeType: "image/heic", buffer: HEIC }, { result: "no", person: "no", alt: "A whiteboard" });
    await page.waitForURL(/attached=1/, { timeout: 30000 });
    const heicRow = (await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId) })).find((r) => r.originalFilename === "IMG_0412.heic");
    if (!heicRow || heicRow.mime !== "image/heic" || !/\.heic$/.test(heicRow.blobKey) || heicRow.bytes !== HEIC.length) throw new Error(`the HEIC is stored as sent: ${JSON.stringify(heicRow)}`);
    if (!heicRow.displayKey || !/-display\.jpg$/.test(heicRow.displayKey) || !(heicRow.displayBytes && heicRow.displayBytes > 0)) throw new Error(`a JPEG rendition sits beside it and its bytes count: ${JSON.stringify(heicRow)}`);
    if (heicRow.width !== 16 || heicRow.height !== 12) throw new Error(`dimensions read from the rendition: ${heicRow.width}x${heicRow.height}`);
    const store = await listed();
    if (!store.some((o) => o.pathname === heicRow.displayKey && /PROOF/i.test(o.store) && o.access === "private")) throw new Error("the rendition is in the private store");
    const shown = await page.request.get(`${base}/api/proofs/attachments/${heicRow.id}?display=1`);
    const shownBody = await shown.body();
    if (shown.status() !== 200 || shown.headers()["content-type"] !== "image/jpeg" || shownBody[0] !== 0xff || shownBody[1] !== 0xd8) throw new Error(`the page is shown the JPEG: ${shown.status()} ${shown.headers()["content-type"]}`);
    const original = await page.request.get(`${base}/api/proofs/attachments/${heicRow.id}?download=1`);
    if (original.headers()["content-type"] !== "image/heic" || Buffer.compare(await original.body(), HEIC) !== 0 || !/IMG_0412\.heic/.test(original.headers()["content-disposition"] ?? "")) throw new Error("the download is the original HEIC under its own name");
    if (!(await page.locator(`[data-testid="attachment"][data-kind="image"] img[src*="${heicRow.id}?display=1"]`).count())) throw new Error("the proof page shows the rendition, not the HEIC");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(`#att-${heicRow.id} [data-testid="attachment-delete"]`).click()]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const after = await listed();
    if (after.some((o) => o.pathname === heicRow.blobKey || o.pathname === heicRow.displayKey)) throw new Error("deleting a HEIC deletes the original and the rendition");
    if ((await page.locator('[data-testid="attachment"]').count()) !== 2) throw new Error("two attachments remain");
    console.log("✓ HEIC end to end: stored as sent, a JPEG rendition shown and counted, the original on download, both gone on delete");

    // A signed-in reader at a file that is not theirs (or that never existed) sees one plain sentence
    const notMine = await page.request.get(`${base}/api/proofs/attachments/not-an-id`);
    if (notMine.status() !== 404 || (await notMine.text()) !== "There's no file here for you to see. If someone shared this link with you, the file is theirs: ask them for a copy.") throw new Error(`a blocked read is a sentence, not a broken image: ${notMine.status()} ${await notMine.text()}`);
    console.log("✓ a file that is not yours reads as a sentence");

    // The composer offers the proof's media; a result-showing image inherits the typed-dollar block; an image without alt text warns
    await page.goto(`${base}/content/compose`);
    await page.waitForLoadState("networkidle");
    const mediaSelect = page.locator('[data-testid="media-from-proof"]');
    await mediaSelect.waitFor({ timeout: 10000 });
    if ((await page.locator('[data-testid="result-media-block"]').count()) !== 0) throw new Error("nothing attaches on its own");
    const bodyBox = 'textarea[placeholder^="Type content"]';
    await page.fill(bodyBox, "Four clients in thirty days. Here is what Dana's month looked like.");
    const resultOption = await mediaSelect.locator("option", { hasText: "stripe-march.png" }).getAttribute("value");
    await mediaSelect.selectOption(resultOption!);
    await page.locator('[data-testid="result-media-block"]').waitFor({ timeout: 5000 });
    await expectText(page, "Dollar figures are real numbers or marked illustrative", "the same wording as a typed dollar");
    if (!(await page.locator('button:has-text("Schedule")').first().isDisabled())) throw new Error("a result-showing file blocks scheduling until it is marked");
    if (!(await page.locator('[data-testid="media-alt-warning"]').count())) throw new Error("an image with no alt text warns");
    await page.fill(bodyBox, "Four clients in thirty days. Here is what Dana's month looked like. (Illustrative. Your numbers will differ.)");
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="result-media-block"]').count()) throw new Error("the marker lifts the block");
    const altOption = await mediaSelect.locator("option", { hasText: "before-after.png" }).getAttribute("value");
    await mediaSelect.selectOption(altOption!);
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="media-alt-warning"]').count()) throw new Error("an image with alt text does not warn");
    console.log("✓ composer: offered, never auto-attached; a shown result carries the typed-dollar block with the same wording; alt text warns and only warns");

    // The proof list shows the first image as the thumbnail; the webinar belief step shows the picked proof's images as the pick changes
    await page.goto(`${base}/proof`);
    if (!(await page.locator('[data-testid="proof-thumb"]').count())) throw new Error("the proof list shows the first image as the row's thumbnail");
    await page.goto(`${base}/webinars`);
    await page.click('a:has-text("The Leaky Webinar")');
    await page.waitForURL(/\/webinars\//);
    await page.goto(`${page.url().split("?")[0]}?step=beliefs`);
    await page.waitForLoadState("networkidle");
    if (await page.locator('[data-testid="belief-proof-images-vehicle"]').count()) throw new Error("no images before a proof is picked");
    await page.selectOption('[data-testid="belief-proof-vehicle"]', { label: "Dana R.: 4 clients in 30 days" });
    await page.locator('[data-testid="belief-proof-images-vehicle"]').waitFor({ timeout: 5000 });
    if ((await page.locator('[data-testid="belief-proof-images-vehicle"] img').count()) !== 2) throw new Error("the picked proof's images show before a save");
    if ((await page.locator('[data-testid="belief-proof-images-vehicle"] a[href*="download=1"]').count()) !== 2) throw new Error("a download per image; nothing goes into the deck on its own");
    await page.selectOption('[data-testid="belief-proof-vehicle"]', "");
    await page.waitForTimeout(200);
    if (await page.locator('[data-testid="belief-proof-images-vehicle"]').count()) throw new Error("clearing the pick clears the images");
    console.log("✓ the list's thumbnail and the belief step's live images: offered, downloadable, never attached");

    // Settings shows the quota, and the same visit reconciles the store: an object with no row older than the floor is
    // deleted, a young one (an upload still being recorded) and every recorded object stay
    const ws = (await db.query.proofAttachments.findFirst({ where: eq(schema.proofAttachments.proofId, proofId) }))!.workspaceId;
    const plant = async (key: string, uploadedAt: string) => {
      const r = await fetch(`http://localhost:${blobPort}/?pathname=${encodeURIComponent(key)}`, { method: "PUT", body: PNG, headers: { authorization: "Bearer vercel_blob_rw_PROOFSTORE_testsecret", "x-content-type": "image/png", "x-vercel-blob-access": "private", "x-mock-uploaded-at": uploadedAt } });
      if (r.status !== 200) throw new Error(`could not plant an orphan: ${r.status}`);
    };
    const oldOrphan = `proofs/${ws}/${proofId}/orphan-old.png`;
    const oldOrphanOtherProof = `proofs/${ws}/some-deleted-proof/orphan-old.png`;
    const youngOrphan = `proofs/${ws}/${proofId}/orphan-young.png`;
    await plant(oldOrphan, new Date(Date.now() - 45 * 60 * 1000).toISOString());
    await plant(oldOrphanOtherProof, new Date(Date.now() - 45 * 60 * 1000).toISOString());
    await plant(youngOrphan, new Date().toISOString());
    const recordedBefore = (await listed()).filter((o) => o.pathname.startsWith("proofs/") && !o.pathname.includes("orphan-")).map((o) => o.pathname).sort();
    await page.goto(`${base}/settings`);
    await expectText(page, "of 2 GB used", "quota line");
    // The reconcile runs after the response is sent: give it a moment.
    let afterSettings: string[] = [];
    for (let i = 0; i < 60; i++) {
      afterSettings = (await listed()).map((o) => o.pathname);
      if (!afterSettings.includes(oldOrphan) && !afterSettings.includes(oldOrphanOtherProof)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (afterSettings.includes(oldOrphan) || afterSettings.includes(oldOrphanOtherProof)) throw new Error("an object with no row, older than the floor, is deleted on the Settings visit, on any proof in the workspace");
    if (!afterSettings.includes(youngOrphan)) throw new Error("an object younger than the floor is left alone: it may still be being recorded");
    if (afterSettings.filter((k) => k.startsWith("proofs/") && !k.includes("orphan-")).sort().join() !== recordedBefore.join()) throw new Error("every recorded object stays");
    await fetch(`http://localhost:${blobPort}/delete`, { method: "POST", body: JSON.stringify({ urls: [`http://localhost:${blobPort}/private/${youngOrphan}`] }), headers: { authorization: "Bearer vercel_blob_rw_PROOFSTORE_testsecret", "content-type": "application/json" } });
    console.log("✓ settings: storage against the quota; the visit reconciles the workspace's tree (old orphans on any proof gone, a young one kept, recorded objects untouched)");

    // Deletion deletes the object first, then the row; deleting the proof takes every object with it
    await page.goto(`${base}/proof/${proofId}`);
    await submit(page, '[data-testid="attachment-delete"]');
    await page.waitForURL(new RegExp(`/proof/${proofId}$`));
    if ((await page.locator('[data-testid="attachment"]').count()) !== 1) throw new Error("one attachment left");
    if ((await listed()).filter((o) => o.pathname.startsWith("proofs/")).length !== 1) throw new Error("the deleted attachment's object left the store");
    await submit(page, 'button:has-text("Delete this proof")');
    await page.waitForURL(/\/proof$/);
    if ((await listed()).some((o) => o.pathname.startsWith("proofs/"))) throw new Error("deleting the proof must take its objects with it");
    if ((await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId) })).length) throw new Error("rows outlived the proof");
    console.log("✓ deletion actually deletes: the object, then the row; the proof takes its files with it");
    void user;
  } finally {
    await browser.close();
    try {
      process.kill(-blob.pid!);
    } catch {}
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Proofs smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
