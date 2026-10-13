/**
 * Building with AI: the words (rev 768). A client finds a word by search and by its #link at phone width; the coach edits one,
 * hides one and adds one on Coach → Glossary, and the client sees each on the next load; Back to the original undoes them.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  await db.delete(schema.glossaryEntries).where(eq(schema.glossaryEntries.workspaceId, m.workspaceId));

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      await page.context().clearCookies();
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };
    await signIn("client");
    await page.goto(`${base}/glossary`);
    await page.locator('[data-testid="glossary-entry"]').first().waitFor({ timeout: 20000 });
    if ((await page.locator('[data-testid="glossary-entry"]').count()) !== 27 || (await page.locator('[data-testid="glossary-section"]').count()) !== 4) throw new Error("rev 768's words under its four headings");
    await page.fill('[data-testid="glossary-search"]', "secret password");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="glossary-entry"]').length === 1);
    if ((await page.locator('[data-testid="glossary-entry"]').getAttribute("data-slug")) !== "api-key") throw new Error("search finds a word by its meaning");
    await page.fill('[data-testid="glossary-search"]', "");
    if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) throw new Error("the glossary fits a phone");
    await page.goto(`${base}/glossary#webhook`);
    await page.locator("#webhook").waitFor({ timeout: 10000 });
    console.log("✓ the glossary: 27 words under four headings, search by meaning, a #link per word, fits 390");

    await signIn("coach");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${base}/coach/glossary`);
    const bug = page.locator('[data-testid="glossary-edit"][data-slug="bug"]');
    await bug.waitFor({ timeout: 20000 });
    await bug.locator("summary").click();
    await bug.locator('[data-testid="glossary-meaning"]').fill("Something that doesn't work yet. Tell the agent what you saw.");
    await submit(page, '[data-testid="glossary-edit"][data-slug="bug"] button:has-text("Save")');
    const tokens = page.locator('[data-testid="glossary-edit"][data-slug="tokens"]');
    await tokens.locator("summary").click();
    await tokens.locator('[data-testid="glossary-hide"]').check();
    await submit(page, '[data-testid="glossary-edit"][data-slug="tokens"] button:has-text("Save")');
    await page.fill('[data-testid="glossary-add"] input[name="term"]', "Pull request (PR)");
    await page.fill('[data-testid="glossary-add"] textarea[name="meaning"]', "A change an agent asks to have checked before it joins the main version.");
    await submit(page, '[data-testid="glossary-add"] button:has-text("Add")');

    await signIn("client");
    await page.goto(`${base}/glossary`);
    await page.locator('[data-testid="glossary-entry"]').first().waitFor({ timeout: 20000 });
    const slugs = await page.locator('[data-testid="glossary-entry"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-slug")));
    if (slugs.includes("tokens") || !slugs.includes("pull-request") || slugs.length !== 27) throw new Error(`a hidden word is gone, an added one is there: ${slugs.join(",")}`);
    if (!(await page.locator("#bug").innerText()).includes("Tell the agent what you saw.")) throw new Error("the coach's edit shows on the next load");
    console.log("✓ Coach → Glossary: an edit, a hidden word and a new word each show to a client on the next load");

    await signIn("coach");
    await page.goto(`${base}/coach/glossary`);
    await page.locator('[data-testid="glossary-edit"][data-slug="bug"] summary').click();
    await submit(page, '[data-testid="glossary-edit"][data-slug="bug"] button:has-text("Back to the original words")');
    const row = await db.query.glossaryEntries.findFirst({ where: eq(schema.glossaryEntries.slug, "bug") });
    if (row) throw new Error("Back to the original words takes the change away");
    console.log("✓ Back to the original words restores the seed");
  } finally {
    await db.delete(schema.glossaryEntries).where(eq(schema.glossaryEntries.workspaceId, m.workspaceId));
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Glossary smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
