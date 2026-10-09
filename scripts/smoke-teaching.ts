/**
 * The teaching library and story bank (rev 618): the coach uploads a library file and the story bank together, sees what was
 * added, priced and unreadable, uploads again and nothing doubles; sets a story's status and a re-upload keeps it; writes a
 * ladder that is given only ready, unpriced material and names what it used, shown on the ladder page with the call's moment.
 * A client's ladder is never given any of it, and the page and the upload refuse a client.
 * Runs against scripts/mock-ai.ts; the dev server must be started with AI_BASE_URL=http://localhost:4020 (dev-server.sh does).
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";
import { LIBRARY, LIBRARY_FILE, STORIES, STORIES_FILE } from "./fixtures/teaching";

const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
async function connectAi(page: Page) {
  await page.goto(`${base}/settings`);
  await page.selectOption('select[name="provider"]', "anthropic");
  await page.fill('input[name="key"]', "sk-ant-good");
  await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
}
const lastUser = async () => ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { user: string }).user;
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

/** Both files into the picker, then Upload; returns each file's result line once both are in. */
async function upload(page: Page): Promise<Record<string, string>> {
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="teaching-files"]').setInputFiles([
    { name: LIBRARY_FILE, mimeType: "text/markdown", buffer: Buffer.from(LIBRARY) },
    { name: STORIES_FILE, mimeType: "text/markdown", buffer: Buffer.from(STORIES) },
  ]);
  const runs = Number(await page.locator('[data-testid="teaching-upload"]').getAttribute("data-runs"));
  await page.locator('[data-testid="teaching-send"]:not([disabled])').click();
  await page.locator(`[data-testid="teaching-upload"][data-runs="${runs + 1}"]`).waitFor({ timeout: 30000 });
  const rows = page.locator('[data-testid="teaching-result"]');
  must((await rows.count()) === 2, "one result line per file, this upload's only");
  await page.waitForLoadState("networkidle");
  const out: Record<string, string> = {};
  for (const r of await rows.all()) out[(await r.getAttribute("data-file")) ?? ""] = await r.innerText();
  return out;
}

/** A ladder written with the mock: Method + Resource, no keyword, no graphic. Returns its id. */
async function writeLadder(page: Page, topic: string): Promise<string> {
  await page.goto(`${base}/content/ladders`);
  await page.waitForLoadState("networkidle");
  await page.selectOption('select[name="format"]', "method_resource");
  await page.fill('input[name="topic"]', topic);
  if (await page.locator('select[name="keyword"] option[value="NONE"]').count()) await page.selectOption('select[name="keyword"]', "NONE");
  const graphic = page.locator('[data-testid="ladder-make-graphic"]');
  if ((await graphic.count()) && (await graphic.isChecked())) await graphic.uncheck();
  await Promise.all([page.waitForURL(/\/content\/ladders\/[a-z0-9-]+$/i, { timeout: 60000 }), page.click('button:has-text("Write the ladder")')]);
  return page.url().split("/").pop()!.split("?")[0];
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
    const { and, eq, sql } = await import("drizzle-orm");
    const { readLibrary, readStoryBank } = await import("@/lib/engine/teaching");
    const lib = readLibrary(LIBRARY);
    const bank = readStoryBank(STORIES);
    must(lib.entries.length === 3 && bank.entries.length === 3, "the fixtures read as three answers and three stories");
    const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;

    // The coach's page, from the Coach view
    await login(page, "As the coach");
    await connectAi(page);
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/coach\/teaching/), page.click('[data-testid="coach-teaching-link"]')]);
    await expectText(page, "No stories yet", "empty bank");

    // First upload: every count is said, read from the parser that wrote the rows
    let res = await upload(page);
    const pricedT = lib.entries.filter((e) => e.hasPrice).length;
    const pricedS = bank.entries.filter((e) => e.hasPrice).length;
    must(res[LIBRARY_FILE]?.includes(`Library: ${lib.entries.length} added, 0 updated, 0 unchanged, ${pricedT} name a price`) && res[LIBRARY_FILE].includes(`${lib.unreadable.length} couldn't be read (${lib.unreadable[0]})`), `the library line says what came in: ${res[LIBRARY_FILE]}`);
    must(res[STORIES_FILE]?.includes(`Story bank: ${bank.entries.length} added, 0 updated, 0 unchanged, ${pricedS} name a price`) && res[STORIES_FILE].includes(`(${bank.unreadable[0]})`), `the story bank line says what came in: ${res[STORIES_FILE]}`);
    const ready = bank.entries.filter((e) => e.status === "ready").length;
    const check = bank.entries.filter((e) => e.status === "check").length;
    await expectText(page, `In the library: ${lib.entries.length} answers from 1 file. Story bank: ${ready} ready, ${check} to check, 0 need permission.`, "totals");
    must((await page.locator('[data-testid="story-row"]').count()) === bank.entries.length, "every story is listed");
    console.log("✓ upload: both files together, added, priced and unreadable counted, the totals and the list");

    // Again: nothing doubles, the index included
    res = await upload(page);
    must(res[LIBRARY_FILE]?.includes(`0 added, 0 updated, ${lib.entries.length} unchanged`) && res[STORIES_FILE]?.includes(`0 added, 0 updated, ${bank.entries.length} unchanged`), `a second upload changes nothing: ${JSON.stringify(res)}`);
    const rows = async (t: "teaching_entries" | "story_items" | "teaching_fts" | "story_fts") => Number(((await db.all<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${t} WHERE user_id = '${coach.id}'`)))[0] as { n: number }).n);
    must((await rows("teaching_entries")) === lib.entries.length && (await rows("teaching_fts")) === lib.entries.length, "one row and one index row per answer");
    must((await rows("story_items")) === bank.entries.length && (await rows("story_fts")) === bank.entries.length, "one row and one index row per story");
    console.log("✓ upload again: everything unchanged, no row or index row doubled");

    // A ladder of the coach's own: given ready, unpriced material only, and it names what it used
    const id = await writeLadder(page, "Landing your first client from one conversation");
    const prompt = await lastUser();
    must(prompt.includes("FROM YOUR TEACHING LIBRARY"), "the coach's ladder is given the library");
    const readyStory = bank.entries.find((e) => e.status === "ready" && !e.hasPrice)!;
    must(prompt.includes(readyStory.title), "the ready story is offered");
    for (const e of bank.entries.filter((x) => x.status !== "ready" || x.hasPrice)) must(!prompt.includes(e.title), `"${e.title}" (${e.status}${e.hasPrice ? ", priced" : ""}) must never reach the writer`);
    for (const e of lib.entries.filter((x) => x.hasPrice)) must(!prompt.includes(e.question), "an answer naming a price never reaches the writer");
    must(!/\$\s?\d/.test(prompt.slice(prompt.indexOf("FROM YOUR TEACHING LIBRARY"))), "no price anywhere in the material");
    await expectText(page, "Material used", "panel");
    const items = page.locator('[data-testid="material-item"]');
    must((await items.count()) === 2, `the panel lists the two items the writer named, got ${await items.count()}`);
    const story = items.filter({ has: page.locator('[data-testid="material-fathom"]') });
    must((await story.count()) === 1 && (await story.innerText()).includes(readyStory.title), "the story is listed by its title");
    const link = story.locator('[data-testid="material-fathom"]');
    must((await link.getAttribute("href")) === readyStory.fathomUrl && (await link.innerText()).includes("at 12:04"), `the story links to its call at its moment: ${await link.innerText()}`);
    const recorded = await db.query.ladderMaterial.findMany({ where: and(eq(schema.ladderMaterial.ladderId, id), eq(schema.ladderMaterial.userId, coach.id)) });
    must(recorded.length >= 2 && recorded.filter((r) => r.used).length === 2, `what was offered and used is kept: ${recorded.length} offered, ${recorded.filter((r) => r.used).length} used`);
    console.log("✓ the coach's ladder: only ready, unpriced material, the two it used on the panel with the call at 12:04");

    // Danno clears a story to check; a re-upload keeps his status
    const toClear = bank.entries.find((e) => e.status === "check")!;
    await page.goto(`${base}/coach/teaching?status=check`);
    await page.waitForLoadState("networkidle");
    const row = page.locator('[data-testid="story-row"]').filter({ hasText: toClear.title });
    must((await row.count()) === 1 && (await page.locator('[data-testid="story-row"]').count()) === check, "the filter shows the stories to check");
    await row.locator('[data-testid="story-status"]').selectOption("ready");
    await submit(page, `[data-testid="story-row"]:has-text("${toClear.title}") [data-testid="story-status-save"]`);
    await expectText(page, "Saved.", "status saved");
    await page.goto(`${base}/coach/teaching`);
    await upload(page);
    const kept = await db.query.storyItems.findFirst({ where: and(eq(schema.storyItems.userId, coach.id), eq(schema.storyItems.title, toClear.title)) });
    must(kept?.status === "ready" && kept.statusSetBy === coach.id, "the status Danno set stands over the file's on a re-upload");
    console.log("✓ a story cleared in the app stays cleared when the bank is uploaded again");

    // A client: never given any of it, and the page and the upload refuse them
    await logout(page);
    await login(page, "As a client");
    await connectAi(page);
    const clientLadder = await writeLadder(page, "Landing your first client from one conversation");
    must(!(await lastUser()).includes("FROM YOUR TEACHING LIBRARY"), "a client's ladder is never given the library");
    must(!(await page.locator('[data-testid="material-used"]').count()), "no Material used panel on a client's ladder");
    must(!(await db.query.ladderMaterial.findMany({ where: eq(schema.ladderMaterial.ladderId, clientLadder) })).length, "nothing recorded for a client's ladder");
    await page.goto(`${base}/coach/teaching`);
    must(!page.url().includes("/coach/teaching") || !(await page.locator('[data-testid="teaching-upload"]').count()), "the teaching page is not a client's");
    const api = await page.request.post(`${base}/api/teaching/import`, { data: { file: STORIES_FILE, text: STORIES } });
    must(api.status() === 403, `the upload refuses a client, got ${api.status()}`);
    console.log("✓ a client's ladder gets none of it; the page and the upload refuse a client");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\nteaching walk passed");
  } finally {
    await browser.close();
    try {
      process.kill(-ai.pid!);
    } catch {}
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
