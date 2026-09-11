/**
 * Lead magnets: type first, a keyword that two magnets never share, content in the type's shape written from what is
 * already true (blacklisted claims stripped and said so), a typeset PDF and an uploaded file served from the public magnets
 * prefix only, a hosted page and a tracked link that both work with no session, the link's counts per source with nothing
 * about the reader on it, a private attachment that never resolves anywhere, and a ladder that inherits the magnet's keyword.
 * Runs against scripts/mock-ai.ts and scripts/mock-blob.ts; the dev server must be started with AI_BASE_URL=http://localhost:4020,
 * BLOB_READ_WRITE_TOKEN set to any vercel_blob_rw_ token, and VERCEL_BLOB_API_URL and NEXT_PUBLIC_VERCEL_BLOB_API_URL at
 * http://localhost:4050 (scripts/dev-server.sh sets all of these).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const blobPort = 4050;
// This process writes a private attachment through the same store the server uses, so it points the SDK at the mock too.
process.env.BLOB_READ_WRITE_TOKEN ??= "vercel_blob_rw_TESTSTORE_testsecret";
process.env.VERCEL_BLOB_API_URL ??= `http://localhost:${blobPort}`;

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
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector}`);
}
const lastSystem = async () => ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] }).system.map((b) => b.text).join("\n\n");
/** A request with no cookie at all: what a reader who has never seen HelixOS sends. */
const anon = (url: string) => fetch(url, { redirect: "manual" });

async function main() {
  const ai = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
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
    const { putPrivateAttachment } = await import("@/lib/storage");
    const { publicUrlFor, capLabel } = await import("@/lib/engine/storage-policy");

    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, user.id) }))!;
    const personal = [user.email, user.id, membership.workspaceId, user.name.split(" ")[0], user.name.split(" ")[1]].map((s) => s.toLowerCase());
    const noPersonalData = (url: string, label: string) => {
      for (const p of personal) if (url.toLowerCase().includes(p)) throw new Error(`[${label}] ${url} carries personal data (${p})`);
    };

    // Nav entry and empty state
    await page.goto(`${base}/magnets`);
    await expectText(page, "No lead magnets yet", "empty state");
    if (!(await page.locator('nav a[href="/magnets"]').count())) throw new Error("no nav entry for lead magnets");

    // Create: type first, then the title, the promise and the keyword; the record starts as the type's scaffold
    await page.selectOption('[data-testid="new-magnet"] select[name="type"]', "guide");
    await fillExact(page, '[data-testid="new-magnet"] input[name="title"]', "The 12-Minute Content Plan");
    await fillExact(page, '[data-testid="new-magnet"] input[name="promise"]', "A week of posts planned in twelve minutes.");
    await fillExact(page, '[data-testid="new-magnet"] input[name="audience"]', "coaches who post when they remember to");
    await fillExact(page, '[data-testid="new-magnet"] input[name="keyword"]', "plan");
    await submit(page, '[data-testid="new-magnet"] button[type="submit"]');
    await page.waitForURL(/\/magnets\/[a-z0-9-]+$/i);
    const magnetId = page.url().split("/").pop()!;
    await expectText(page, "skeleton, fill the blanks", "scaffold");
    const scaffold = await page.locator('[data-testid="magnet-content"]').inputValue();
    if (!scaffold.includes("## Why this matters") || !scaffold.startsWith("A week of posts planned in twelve minutes.")) throw new Error(`a guide's scaffold is its headings with the promise as the intro:\n${scaffold}`);
    if (/\n- /.test(scaffold)) throw new Error("the scaffold invented items");
    const link = (await page.locator('[data-testid="magnet-link"]').innerText()).trim();
    if (link !== `${base}/g/the-12-minute-content-plan`) throw new Error(`the tracked link is the title's slug: ${link}`);
    noPersonalData(link, "tracked link");
    const keywordBadge = await page.locator('[data-testid="magnet-form"] input[name="keyword"]').inputValue();
    if (keywordBadge !== "PLAN") throw new Error(`keyword is upper-cased letters and digits: "${keywordBadge}"`);
    console.log("✓ create: type first, scaffold in the type's shape, keyword PLAN, tracked link from the title with nothing personal on it");

    // With a key: written from the Big Promise, the audience, the offer, approved proof and confirmed evidence; the blacklisted line comes out and the page says so
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
    await page.goto(`${base}/magnets/${magnetId}`);
    await submit(page, '[data-testid="magnet-generate"]');
    await page.waitForURL(/stripped=1/);
    await expectText(page, "drafted by AI", "generated");
    const system = await lastSystem();
    for (const must of ["lead magnet", "Proof may be used only verbatim as given", "Studies may be cited only from the list given", "never in the intro or the sections"]) if (!system.includes(must)) throw new Error(`the prompt must say "${must}"`);
    const written = await page.locator('[data-testid="magnet-content"]').inputValue();
    if (!written.includes("- Pick one platform.")) throw new Error(`the model's sections were not kept:\n${written}`);
    if (/21 days/.test(written)) throw new Error("the blacklisted claim stayed in the content");
    const stripped = await page.locator('[data-testid="magnet-stripped"]').innerText();
    if (!/This one doesn't hold up, so it came out of the draft/.test(stripped)) throw new Error(`the strip notice is the shared frame: "${stripped}"`);
    if ((await page.locator('textarea[name="personalDm"]').inputValue()) !== "Mock DM: here it is. What are you working on right now?") throw new Error("the hand-over messages were not filled");
    console.log("✓ AI: sections in the type's shape from the facts given, the blacklisted line stripped and said so, hand-overs filled");

    // The hand-overs the model wrote end in a question, so no craft warning shows; a DM saved without one gets the warning, and only a warning
    if (await page.locator('[data-testid="dm-question-warning"], [data-testid="chatbot-question-warning"]').count()) throw new Error("the model's DM and chatbot answer end in a question: no warning");
    await page.locator('summary:has-text("Hand-over messages")').click();
    await fillExact(page, 'textarea[name="personalDm"]', "Here it is, enjoy.");
    await submit(page, '[data-testid="magnet-save"]');
    await page.waitForURL(/saved=1/);
    await expectText(page, "Ends without a question", "dm warning");
    if (await page.locator('[data-testid="chatbot-question-warning"]').count()) throw new Error("the chatbot answer still ends in a question");
    console.log("✓ craft: a DM that ends without a question is warned, saved all the same");

    // Build the PDF: written to the bucket under the public magnets prefix; the app's /files address sends a reader to the CDN URL; a real PDF, no session
    await submit(page, '[data-testid="magnet-build-pdf"]');
    await page.waitForURL(/pdf=1/);
    const pdfHref = await page.locator('[data-testid="magnet-pdf-url"]').getAttribute("href");
    if (!pdfHref?.startsWith(`http://localhost:${blobPort}/public/magnets/the-12-minute-content-plan/`)) throw new Error(`the PDF is served by the bucket under the magnet's public folder: ${pdfHref}`);
    noPersonalData(pdfHref, "pdf url");
    const pdfKey = (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, magnetId) }))!.pdfKey!;
    const viaApp = await anon(`${base}/files/${pdfKey}`);
    if (viaApp.status !== 302 || viaApp.headers.get("location") !== pdfHref) throw new Error(`/files/<key> sends the reader to the bucket: ${viaApp.status} → ${viaApp.headers.get("location")}`);
    const pdfRes = await anon(pdfHref);
    if (pdfRes.status !== 200 || !pdfRes.headers.get("content-type")?.startsWith("application/pdf")) throw new Error(`anonymous PDF read: ${pdfRes.status} ${pdfRes.headers.get("content-type")}`);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    if (pdfBytes.subarray(0, 4).toString() !== "%PDF") throw new Error("the served object is not a PDF");
    const stored = (await (await fetch(`http://localhost:${blobPort}/__list`)).json()) as { objects: { pathname: string; access: string }[] };
    if (!stored.objects.some((o) => o.pathname === pdfKey && o.access === "public")) throw new Error("the PDF is in the bucket, public, under its key");
    const indexRow = await db.query.files.findFirst({ where: eq(schema.files.key, pdfKey) });
    if (!indexRow || !indexRow.isPublic || indexRow.url !== pdfHref || "bytes" in indexRow) throw new Error("the index row records where the object is, never the bytes");
    console.log(`✓ PDF: built into the bucket, ${pdfBytes.length} bytes, /files redirects to the CDN address, served anonymously`);

    // Hosted page and tracked link with no session
    const pageRes = await anon(`${base}/m/the-12-minute-content-plan`);
    const pageHtml = await pageRes.text();
    if (pageRes.status !== 200 || !pageHtml.includes("The 12-Minute Content Plan") || !pageHtml.includes("Download the PDF")) throw new Error(`hosted page anonymously: ${pageRes.status}`);
    if (pageHtml.includes(user.email)) throw new Error("the hosted page leaks the client's email");
    const g1 = await anon(`${base}/g/the-12-minute-content-plan?src=chatbot`);
    if (g1.status !== 302 || !g1.headers.get("location")?.endsWith("/m/the-12-minute-content-plan")) throw new Error(`tracked link: ${g1.status} → ${g1.headers.get("location")}`);
    const g2 = await anon(`${base}/g/the-12-minute-content-plan?src=${encodeURIComponent("<script>alert(1)</script>")}`);
    if (g2.status !== 302) throw new Error("a bad src still redirects");
    const g3 = await anon(`${base}/g/no-such-magnet`);
    if (g3.status !== 404) throw new Error("an unknown slug is a plain 404");
    await page.goto(`${base}/magnets/${magnetId}`);
    const count = async (src: string) => Number((await page.locator(`[data-testid="magnet-hits"] tr[data-src="${src}"] td`).last().innerText()).trim());
    if ((await count("chatbot")) !== 1 || (await count("other")) !== 1) throw new Error("one hit under chatbot, the bad src counted as other");
    if ((await page.locator('[data-testid="magnet-hits-total"]').innerText()).trim() !== "2") throw new Error("two hits in all");
    const hits = await db.query.leadMagnetHits.findMany({ where: eq(schema.leadMagnetHits.magnetId, magnetId) });
    if (hits.some((h) => !["chatbot", "other"].includes(h.src)) || hits.some((h) => JSON.stringify(h).includes("script"))) throw new Error("the hit row carries only a source from the closed list");
    console.log("✓ public: hosted page and tracked link work with no session; counts per source; a bad src is 'other' and nothing else is kept");

    // The client nominates the PDF as the target: the tracked link now opens the PDF
    await page.selectOption('[data-testid="magnet-primary"]', "pdf");
    await submit(page, '[data-testid="magnet-save"]');
    await page.waitForURL(/saved=1/);
    const g4 = await anon(`${base}/g/the-12-minute-content-plan?src=dm`);
    if (g4.status !== 302 || g4.headers.get("location") !== pdfHref) throw new Error(`the link opens the nominated PDF at the bucket, one hop: ${g4.headers.get("location")}`);
    console.log("✓ the tracked link opens what the client nominated");

    // A private attachment: written by the other writer with private access, never public, no URL, 404 on the public path
    const priv = await putPrivateAttachment(membership.workspaceId, "proof-screenshot.png", Buffer.from("not really a png"), "image/png");
    if (priv.url !== null || publicUrlFor(priv.key) !== null) throw new Error("a private attachment resolved to a URL");
    const privStored = (await (await fetch(`http://localhost:${blobPort}/__list`)).json()) as { objects: { pathname: string; access: string }[] };
    if (privStored.objects.find((o) => o.pathname === priv.key)?.access !== "private") throw new Error("the private attachment went to the bucket with private access");
    if ((await anon(`http://localhost:${blobPort}/${priv.key}`)).status !== 403) throw new Error("the bucket refuses a private object without the token");
    const privRes = await anon(`${base}/files/${priv.key}`);
    if (privRes.status !== 404) throw new Error(`a private key must be 404 on /files: ${privRes.status}`);
    const forged = await anon(`${base}/files/public/magnets/the-12-minute-content-plan/nope-proof-screenshot.png`);
    if (forged.status !== 404) throw new Error("a guessed public key that was never written is 404");
    const row = await db.query.files.findFirst({ where: eq(schema.files.key, priv.key) });
    if (!row || row.isPublic) throw new Error("the private row is recorded private");
    // Belt and braces: flip the flag on a private-prefix row and the prefix check still refuses it
    await db.update(schema.files).set({ isPublic: true }).where(eq(schema.files.key, priv.key));
    if ((await anon(`${base}/files/${priv.key}`)).status !== 404) throw new Error("a private-prefix key served because of a flag alone");
    await db.delete(schema.files).where(eq(schema.files.key, priv.key));
    console.log("✓ private attachment: no URL, 404 on the public path, the prefix wins over the flag");

    // Upload a file made elsewhere: browser to bucket on a token from this app, under the magnet's own folder, recorded after reading it back
    await page.goto(`${base}/magnets/${magnetId}`);
    await expectText(page, `Up to ${capLabel()}`, "cap from the policy");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles('[data-testid="magnet-file"]', { name: "cover art.png", mimeType: "image/png", buffer: png });
    const serverBodies: Buffer[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith(base) && r.method() === "POST") serverBodies.push(r.postDataBuffer() ?? Buffer.alloc(0));
    });
    await page.click('[data-testid="magnet-upload"]');
    await page.waitForURL(/uploaded=1/, { timeout: 15000 });
    // The token request and the record call reach this app; the file's bytes (raw or base64) never do.
    if (serverBodies.some((b) => b.includes(png.subarray(0, 8)) || b.includes(png.toString("base64").slice(0, 24)))) throw new Error("the bytes must go to the bucket, never through this app");
    const fileHref = await page.locator('[data-testid="magnet-file-url"]').getAttribute("href");
    if (!fileHref?.startsWith(`http://localhost:${blobPort}/public/magnets/the-12-minute-content-plan/`) || !fileHref.endsWith("-cover-art.png")) throw new Error(`uploaded file address: ${fileHref}`);
    const fileRes = await anon(fileHref);
    if (fileRes.status !== 200 || fileRes.headers.get("content-type") !== "image/png") throw new Error(`anonymous file read: ${fileRes.status}`);
    const fileRow = (await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, magnetId) }))!;
    const fileIndex = await db.query.files.findFirst({ where: eq(schema.files.key, fileRow.fileKey!) });
    if (!fileIndex?.isPublic || fileIndex.size !== png.length || fileIndex.contentType !== "image/png") throw new Error("the record is what the bucket reports, not what the browser said");
    // A token for another magnet's folder, or a file that is not the client's, is refused at the door
    const forgedToken = await page.evaluate(async (m) => {
      const r = await fetch("/api/magnets/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: "public/magnets/someone-elses-guide/x-file.png", clientPayload: JSON.stringify({ magnetId: m }), multipart: false, callbackUrl: "" } }) });
      return r.status;
    }, magnetId);
    if (forgedToken !== 400) throw new Error(`a token for another folder must be refused: ${forgedToken}`);
    console.log("✓ upload: browser to bucket on a token pinned to the magnet's folder, cap named from the policy, recorded from the bucket's own report, forged folder refused");

    // Copy-outs are on the page
    for (const t of ["magnet-text", "magnet-canva"]) if (!(await page.locator(`[data-testid="${t}"]`).innerText()).includes("Pick one platform.")) throw new Error(`${t} lacks the content`);
    if (!(await page.locator('[data-testid="magnet-canva"]').innerText()).includes("PAGE 1 — COVER")) throw new Error("the Canva hand-off is one block per page");

    // Keyword uniqueness in a workspace: a second magnet with "plan" (any case) is refused with the clash named
    await page.goto(`${base}/magnets`);
    await page.selectOption('[data-testid="new-magnet"] select[name="type"]', "checklist");
    await fillExact(page, '[data-testid="new-magnet"] input[name="title"]', "Launch Week Checklist");
    await fillExact(page, '[data-testid="new-magnet"] input[name="keyword"]', "Plan");
    await submit(page, '[data-testid="new-magnet"] button[type="submit"]');
    await page.waitForURL(/\/magnets\?error=/);
    await expectText(page, 'The keyword PLAN is already on "The 12-Minute Content Plan"', "clash named");
    if ((await page.locator('[data-testid="magnet-row"]').count()) !== 1) throw new Error("the clashing magnet was created anyway");
    console.log("✓ two magnets in one workspace never share a keyword; the clash is named");

    // A ladder that offers the magnet inherits its keyword, whatever the keyword select says; the magnet is named on the ladder
    await page.goto(`${base}/content/ladders`);
    await page.selectOption('select[name="format"]', "method_resource");
    await page.fill('input[name="topic"]', "The twelve minutes that replaced my content day");
    await page.selectOption('select[name="keyword"]', "RESET");
    await page.selectOption('[data-testid="ladder-magnet"]', magnetId);
    await submit(page, 'button:has-text("Write the ladder"), button:has-text("Build the skeleton")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i);
    await expectText(page, "keyword PLAN", "ladder keyword");
    if (!(await page.locator('[data-testid="ladder-magnet-link"]').count())) throw new Error("the ladder names the magnet it offers");
    const ladderId = page.url().split("/").pop()!;
    const ladder = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))!;
    if (ladder.keyword !== "PLAN" || ladder.leadMagnetId !== magnetId) throw new Error(`ladder keyword ${ladder.keyword}, magnet ${ladder.leadMagnetId}`);
    if (/12-Minute Content Plan/i.test(ladder.copy)) throw new Error("the magnet is named in the body; it belongs in the final rung only");
    const ladderSystem = await lastSystem();
    if (!/KEYWORD ROUTING/.test(ladderSystem)) throw new Error("the ladder prompt was not the ladder's");
    console.log("✓ ladder: inherits the magnet's keyword over the select, names the magnet, keeps it out of the body");

    // The pathway task links to the section and shows the count; it does not tick itself
    await page.goto(`${base}/pathway?stage=system-install&task=recA3OidbU8gUYW8x`);
    await expectText(page, "You have 1 lead magnet.", "section task count");
    if (!(await page.locator('[data-testid="section-task"] a[href="/magnets"]').count())) throw new Error("the task links to Lead magnets");
    if (!(await page.locator('button:has-text("Submit for review")').count())) throw new Error("the client still submits the task themselves");
    console.log("✓ pathway: the task shows the count and the link, and waits for the client's submit");

    // Delete: the objects go with the record and the ladder keeps its keyword without the link
    await page.goto(`${base}/magnets/${magnetId}`);
    await submit(page, 'button:has-text("Delete")');
    await page.waitForURL(/\/magnets$/);
    if ((await anon(`${base}/files/${pdfKey}`)).status !== 404 || (await anon(pdfHref)).status !== 404) throw new Error("the PDF outlived its magnet, in the index or in the bucket");
    if ((await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))?.leadMagnetId !== null) throw new Error("the ladder still points at a deleted magnet");
    console.log("✓ delete: objects removed, ladder unlinked");
  } finally {
    await browser.close();
    try {
      process.kill(-ai.pid!);
    } catch {}
    try {
      process.kill(-blob.pid!);
    } catch {}
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Magnets smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
