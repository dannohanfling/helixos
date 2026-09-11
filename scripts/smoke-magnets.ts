/**
 * Lead magnets: type first, a keyword that two magnets never share, content in the type's shape written from what is
 * already true (blacklisted claims stripped and said so), a typeset PDF and an uploaded file served from the public magnets
 * prefix only, a hosted page and a tracked link that both work with no session, the link's counts per source with nothing
 * about the reader on it, a private attachment that never resolves anywhere, and a ladder that inherits the magnet's keyword.
 * Runs against scripts/mock-ai.ts; the dev server must be started with AI_BASE_URL=http://localhost:4020.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;

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
  await new Promise((r) => setTimeout(r, 2000));
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
    const { publicUrlFor } = await import("@/lib/engine/storage-policy");

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
    if ((await page.locator('textarea[name="personalDm"]').inputValue()) !== "Mock DM: here it is, and one question for you.") throw new Error("the hand-over messages were not filled");
    console.log("✓ AI: sections in the type's shape from the facts given, the blacklisted line stripped and said so, hand-overs filled");

    // Build the PDF: served from the public magnets prefix, with no session, as a real PDF
    await submit(page, '[data-testid="magnet-build-pdf"]');
    await page.waitForURL(/pdf=1/);
    const pdfHref = await page.locator('[data-testid="magnet-pdf-url"]').getAttribute("href");
    if (!pdfHref?.startsWith("/files/public/magnets/")) throw new Error(`the PDF lives under the public magnets prefix: ${pdfHref}`);
    noPersonalData(pdfHref, "pdf url");
    const pdfRes = await anon(`${base}${pdfHref}`);
    if (pdfRes.status !== 200 || !pdfRes.headers.get("content-type")?.startsWith("application/pdf")) throw new Error(`anonymous PDF read: ${pdfRes.status} ${pdfRes.headers.get("content-type")}`);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    if (pdfBytes.subarray(0, 4).toString() !== "%PDF") throw new Error("the served object is not a PDF");
    console.log(`✓ PDF: built, ${pdfBytes.length} bytes, served anonymously from ${pdfHref.slice(0, 22)}…`);

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
    if (g4.status !== 302 || g4.headers.get("location") !== `${base}${pdfHref}`) throw new Error(`the link opens the nominated PDF: ${g4.headers.get("location")}`);
    console.log("✓ the tracked link opens what the client nominated");

    // A private attachment: written by the other writer, never public, no URL, 404 on the public path
    const priv = await putPrivateAttachment(membership.workspaceId, "proof-screenshot.png", Buffer.from("not really a png"), "image/png");
    if (priv.url !== null || publicUrlFor(priv.key) !== null) throw new Error("a private attachment resolved to a URL");
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

    // Upload a file made elsewhere: same writer, same prefix, served anonymously
    await page.goto(`${base}/magnets/${magnetId}`);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles('[data-testid="magnet-file"]', { name: "cover art.png", mimeType: "image/png", buffer: png });
    await submit(page, '[data-testid="magnet-upload"]');
    await page.waitForURL(/uploaded=1/);
    const fileHref = await page.locator('[data-testid="magnet-file-url"]').getAttribute("href");
    if (!fileHref?.startsWith("/files/public/magnets/") || !fileHref.endsWith("-cover-art.png")) throw new Error(`uploaded file key: ${fileHref}`);
    const fileRes = await anon(`${base}${fileHref}`);
    if (fileRes.status !== 200 || fileRes.headers.get("content-type") !== "image/png") throw new Error(`anonymous file read: ${fileRes.status}`);
    console.log("✓ upload: served from the public magnets prefix with a safe name");

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

    // Delete: the objects go with the record and the ladder keeps its keyword without the link
    await page.goto(`${base}/magnets/${magnetId}`);
    await submit(page, 'button:has-text("Delete")');
    await page.waitForURL(/\/magnets$/);
    if ((await anon(`${base}${pdfHref}`)).status !== 404) throw new Error("the PDF outlived its magnet");
    if ((await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))?.leadMagnetId !== null) throw new Error("the ladder still points at a deleted magnet");
    console.log("✓ delete: objects removed, ladder unlinked");
  } finally {
    await browser.close();
    try {
      process.kill(-ai.pid!);
    } catch {}
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Magnets smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
