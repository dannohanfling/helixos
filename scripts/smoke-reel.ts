/**
 * Reel to Post, PR A (H-1948, plan H-1953): Content → New from a reel. Maya pastes a transcript that says a number, a price,
 * a client's name and "comment SYSTEM" (not one of her keywords); Create post writes the package with the mock writer: three
 * hooks with one picked, the caption, exactly 5 rungs, the cover frame and on-screen text, the code's flags and the writer's
 * [HEARING] flag, saved as a reel ladder with no keyword. "Use this one" moves the pick and the caption's first line follows;
 * Change a part saves new on-screen words. An empty transcript is refused with a note. At 390 wide nothing scrolls sideways.
 * The walk's ladders and AI key are removed after.
 */
import { chromium, type Page } from "@playwright/test";
import { spawn } from "node:child_process";

// The server's own secret, so the AI key sealed here opens there.
process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
const TRANSCRIPT = [
  "I used to spend three hours every Sunday planning my week, and by Tuesday the plan was dead.",
  "My client Quentin doubled his bookings in a month once he stopped doing that.",
  "The program is $297 a month, but you don't need it to start.",
  "Plan on Tuesday, in ten minutes, and keep it boring.",
  "Comment SYSTEM and I'll send you the checklist.",
].join(" ");

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
}

async function noSideways(page: Page, what: string) {
  const [sw, cw] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, document.scrollingElement!.clientWidth]);
  must(sw <= cw + 1, `${what}: nothing scrolls sideways at 390 (${sw} > ${cw})`);
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 3000));
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { seal } = await import("@/lib/crypto");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const ws = mm.workspaceId;
  const hadKey = await db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, maya.id)) });
  const keyId = newId();
  if (!hadKey) await db.insert(schema.aiCredentials).values({ id: keyId, workspaceId: ws, userId: maya.id, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
  const created: string[] = [];
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext()).newPage();
    await login(page);

    // Content links to it; an empty transcript comes back with a note.
    await page.goto(`${base}/content`);
    await page.getByTestId("new-from-reel").click();
    await page.waitForURL(/\/content\/reel$/);
    await page.getByTestId("reel-form").waitFor();
    must((await page.getByTestId("reel-keyword").inputValue()) === "SAID", "the keyword defaults to the one said on camera");
    await page.goto(`${base}/content/reel?reel=empty`);
    await page.getByTestId("reel-empty").waitFor();
    console.log("✓ Content → New from a reel opens the form; an empty transcript is answered with a note");

    // Create post: the package, saved as a reel ladder.
    await page.goto(`${base}/content/reel`);
    await page.fill('[data-testid="reel-transcript-input"]', TRANSCRIPT);
    await page.getByTestId("reel-create").click();
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+\?reel=new/i, { timeout: 60000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    created.push(id);
    await page.getByTestId("reel-package").waitFor();
    const row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, id) }))!;
    must(row.format === "reel" && row.sourceType === "reel", `saved as a reel (${row.format}, ${row.sourceType})`);
    must(row.sourceTranscript === TRANSCRIPT, "the transcript is kept with it");
    must(row.rungs.length === 5, `exactly 5 rungs (${row.rungs.length})`);
    must(row.keyword === "NONE" && !/comment\s+SYSTEM/i.test(row.copy + row.rungs.map((r) => r.body).join("\n")), "SYSTEM isn't on her facts, so the post carries no keyword");
    must(row.copy === row.igCaption, "the caption is the Instagram caption");
    console.log(`✓ Create post saved a reel ladder: 5 rungs, the transcript kept, no keyword (SYSTEM isn't on her facts)`);

    const kinds = await page.getByTestId("reel-flag").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    for (const k of ["number", "price", "person", "keyword", "hearing"]) must(kinds.includes(k), `a "${k}" flag is listed (${kinds.join(", ")})`);
    must(!(await page.getByTestId("reel-no-flags").count()), "no 'nothing to check' line beside the flags");
    const flagText = (await page.getByTestId("reel-flag").allInnerTexts()).join("\n");
    must(flagText.includes("$297") && flagText.includes("Quentin") && flagText.includes("SYSTEM"), "the flags name what was said");
    console.log(`✓ Before you post lists ${kinds.length} flags: ${kinds.join(", ")}`);

    const hooks = page.getByTestId("reel-hook");
    must((await hooks.count()) === 3, `three hooks (${await hooks.count()})`);
    const picks = await hooks.evaluateAll((els) => els.map((e) => e.getAttribute("data-pick") === "1"));
    must(JSON.stringify(picks) === "[true,false,false]", `the first hook is the pick (${JSON.stringify(picks)})`);
    must((await page.getByTestId("reel-onscreen").innerText()).trim() === "Plan in ten minutes", "the on-screen text shows");
    must((await page.getByTestId("reel-cover").innerText()).includes("THREE HOURS OF PLANNING"), "the cover frame shows");
    console.log("✓ three hooks with one picked, the on-screen text and the cover frame show");

    // Use another hook: the pick moves and the caption's first line follows.
    const second = (await hooks.nth(1).locator("span").first().innerText()).trim();
    await hooks.nth(1).getByTestId("reel-hook-use").click();
    await page.waitForURL(/part=saved/);
    await page.getByTestId("reel-note").waitFor();
    const picks2 = await page.getByTestId("reel-hook").evaluateAll((els) => els.map((e) => e.getAttribute("data-pick") === "1"));
    must(JSON.stringify(picks2) === "[false,true,false]", `the second hook is now the pick (${JSON.stringify(picks2)})`);
    const after = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, id) }))!;
    must(after.hook === second && after.copy.split("\n")[0] === second && after.igCaption === after.copy, `the caption starts with the new pick (${after.copy.split("\n")[0]})`);
    console.log("✓ Use this one moves the pick; the caption's first line follows");

    // Change a part: new on-screen words.
    await page.getByTestId("reel-change-open").click();
    await page.selectOption('[data-testid="reel-change"] select[name="part"]', "onscreen");
    await page.fill('[data-testid="reel-change"] textarea[name="text"]', "Ten minutes, on Tuesday");
    await page.getByTestId("reel-change-save").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="reel-onscreen"]')?.textContent?.trim() === "Ten minutes, on Tuesday", null, { timeout: 30000 });
    console.log("✓ Change a part saves new on-screen words");

    // The list shows it as a Reel; at 390 wide nothing scrolls sideways.
    await page.goto(`${base}/content/ladders`);
    const listRow = page.getByTestId("ladder-row").filter({ has: page.locator(`a[href="/content/ladders/${id}"]`) });
    must((await listRow.innerText()).includes("Reel"), "the ladders list tags it as a Reel");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/content/ladders/${id}`);
    await page.getByTestId("reel-package").waitFor();
    await noSideways(page, "the reel ladder");
    await page.goto(`${base}/content/reel`);
    await page.getByTestId("reel-form").waitFor();
    await noSideways(page, "New from a reel");
    console.log("✓ the list tags it Reel; at 390 neither page scrolls sideways");
  } finally {
    await browser.close();
    for (const id of created) await db.delete(schema.ladders).where(eq(schema.ladders.id, id));
    if (!hadKey) await db.delete(schema.aiCredentials).where(eq(schema.aiCredentials.id, keyId));
    try {
      process.kill(-mock.pid!);
    } catch {}
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
