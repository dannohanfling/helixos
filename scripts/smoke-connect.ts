/**
 * Connect your tools (rev 850): a member connects their own Community Loyalty bot step by step. Today points at the page;
 * the steps are Danno's; a key Community Loyalty refuses keeps nothing and says why in plain words (bad key, plan); a good key
 * is sealed, never shown again, and points at the FAQ agent; the contact ID's shape is checked; Remove key clears it. The coach
 * sees GHL and CL at a glance with the date and can send the setup link. Nothing is wider than a phone. Against
 * scripts/mock-uchat.ts on :4060.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const mockPort = 4060;
const mock = `http://localhost:${mockPort}`;
const RUN = randomUUID().slice(0, 8);
const GOOD = `cl-connect-good-key-${RUN}-0123456789`;

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { CONNECT_ERRORS } = await import("@/lib/engine/connect-copy");
  const up = await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false);
  const proc = up ? null : spawn("npx", ["tsx", "scripts/mock-uchat.ts", String(mockPort)], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40 && !(await fetch(`${mock}/__fields`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await fetch(`${mock}/__reset`, { method: "POST" });
  await fetch(`${mock}/__agents`, { method: "POST", body: JSON.stringify({ agents: [{ ai_agent_ns: "f1a2b3", name: "Booking Agent", description: "Books calls.", prompts: [] }, { ai_agent_ns: "f9faq1", name: "FAQ Agent", description: "Answers questions.", prompts: [] }] }) });

  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const membership = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const before = { clApiToken: membership.clApiToken, clConnectedAt: membership.clConnectedAt, clAgentNs: membership.clAgentNs, clUserNs: membership.clUserNs, faqBotField: membership.faqBotField, connectLinkSentAt: membership.connectLinkSentAt };
  await db.update(schema.memberships).set({ clApiToken: null, clConnectedAt: null, clAgentNs: null, clUserNs: null, faqBotField: null, connectLinkSentAt: null }).where(eq(schema.memberships.id, membership.id));
  const row = async () => (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, membership.id) }))!;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // H-294: the walk reads the clipboard back to check what a Copy put there.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      // A signed-in browser goes straight past /login (rev 843), so switching people starts signed out.
      await page.context().clearCookies();
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };
    await signIn("client");
    // Today points at the page while anything is left to connect.
    await page.locator('[data-testid="today-connect-tools"]').waitFor({ timeout: 20000 });
    await page.click('[data-testid="today-connect-tools"]');
    await page.waitForURL(/\/connect-tools/);
    await page.locator('[data-testid="connect-progress"]').waitFor({ timeout: 15000 });
    const howto = await page.locator('[data-testid="cl-howto"]').innerText();
    for (const s of ["Click your name in the top right, then API Keys.", "Token Name: HelixOS", "Danno can't make it for you."]) if (!howto.includes(s)) throw new Error(`Danno's steps are on the card: ${s}`);
    if (!(await page.locator('[data-testid="connect-later"]').innerText()).includes("Do this later")) throw new Error("the page can be left for later");
    console.log("✓ Today points at Connect your tools; the Community Loyalty steps are Danno's, and Do this later is there");

    // Refusals keep nothing and say why.
    for (const [key, words] of [
      [`badkey-${RUN}-0123456789`, CONNECT_ERRORS.clBadKey],
      [`noplan-${RUN}-0123456789`, CONNECT_ERRORS.clPlan],
    ] as const) {
      await page.fill('[data-testid="cl-token"]', key);
      await submit(page, '[data-testid="cl-key-form"] button:has-text("Connect")');
      // The page before holds the last refusal: wait for this one's words, not just the box.
      const said = await page
        .waitForFunction((w) => document.querySelector('[data-testid="cl-error"]')?.textContent?.trim() === w, words, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (!said) throw new Error(`a refused key says why in plain words: ${await page.locator('[data-testid="cl-error"]').innerText().catch(() => "(no error shown)")}`);
      if ((await row()).clApiToken) throw new Error("a refused key is never kept");
      if (page.url().includes(key) || (await page.content()).includes(key)) throw new Error("a key never rides in the address or the page");
    }
    console.log("✓ a key Community Loyalty refuses keeps nothing and says why: the key, or the plan");

    // A good key: sealed, never shown, the FAQ agent picked.
    await page.fill('[data-testid="cl-token"]', GOOD);
    await submit(page, '[data-testid="cl-key-form"] button:has-text("Connect")');
    await page.locator('[data-testid="cl-connected-badge"]').waitFor({ timeout: 15000 });
    if (!(await page.locator('[data-testid="cl-key-masked"]').innerText()).includes("••••••••")) throw new Error("the saved key shows masked");
    if ((await page.content()).includes(GOOD) || page.url().includes(GOOD)) throw new Error("the key is never rendered back");
    const saved = await row();
    if (!saved.clApiToken || saved.clApiToken === GOOD || saved.clApiToken.includes(GOOD)) throw new Error("the key is stored sealed");
    if (!saved.clConnectedAt) throw new Error("the connection is dated for the coach's row");
    if (saved.clAgentNs !== "f9faq1") throw new Error(`a fresh key points at the FAQ agent: ${saved.clAgentNs}`);
    if ((await page.locator('[data-testid="cl-agent"]').inputValue()) !== "f9faq1") throw new Error("the agent is a pick from the bot's own list, FAQ chosen");
    if ((await page.locator('[data-testid="connect-progress"]').getAttribute("data-done")) === "0") throw new Error("progress counts Community Loyalty");
    console.log("✓ a good key is sealed and never shown again (masked, Replace and check, Remove key); the FAQ agent is chosen from the bot's list");

    // The contact ID's shape is checked before it is kept.
    await page.locator('[data-testid="cl-contact"]').evaluate((el) => el.removeAttribute("pattern"));
    await page.fill('[data-testid="cl-contact"]', "https://not an id");
    await submit(page, '[data-testid="cl-settings"] button:has-text("Save")');
    const shape = await page
      .waitForFunction((w) => document.querySelector('[data-testid="cl-error"]')?.textContent?.trim() === w, CONNECT_ERRORS.clContactShape, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!shape) throw new Error("a contact ID that isn't one is refused in plain words");
    if ((await row()).clUserNs) throw new Error("a contact ID of the wrong shape is never kept");
    await page.fill('[data-testid="cl-contact"]', "f123456u789");
    await page.selectOption('[data-testid="cl-agent"]', "f1a2b3");
    await submit(page, '[data-testid="cl-settings"] button:has-text("Save")');
    await page.waitForFunction(() => document.querySelector('[data-testid="cl-notice"]')?.textContent?.trim() === "Saved.", null, { timeout: 15000 });
    const set = await row();
    if (set.clUserNs !== "f123456u789" || set.clAgentNs !== "f1a2b3") throw new Error(`the contact ID and the agent are saved: ${set.clUserNs} ${set.clAgentNs}`);
    console.log("✓ the contact ID is checked for its shape; the agent and the contact save");

    // Settings carries the same card, and the way to the page.
    await page.goto(`${base}/settings?tab=connections#community-loyalty`);
    await page.locator('#community-loyalty [data-testid="cl-connected-badge"]').waitFor({ timeout: 15000 });
    await page.locator('[data-testid="settings-connect-tools"]').waitFor({ timeout: 5000 });
    console.log("✓ Settings carries the same card and links to Connect your tools");

    // On a phone nothing is wider than the screen. The GoHighLevel rows (H-233) at 390 and 1440: one Copy per permission, the
    // tick count, the one-at-a-time line. The demo client's GoHighLevel connection is set aside for it and put back after.
    const ghlRow = await db.query.socialConnections.findFirst({ where: eq(schema.socialConnections.userId, maya.id) });
    if (ghlRow) await db.delete(schema.socialConnections).where(eq(schema.socialConnections.id, ghlRow.id));
    try {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
        await page.goto(`${base}/connect-tools`);
        await page.locator('[data-testid="connect-progress"]').waitFor({ timeout: 15000 });
        const wide = await page.evaluate(() => document.documentElement.scrollWidth);
        if (wide > width) throw new Error(`at ${width}px the page never scrolls sideways: ${wide}px`);
        const rows = page.locator('[data-testid="ghl-scope-list"] li');
        const n = await rows.count();
        if (n < 19 || (await page.locator('[data-testid="ghl-scope-list"] li button:has-text("Copy")').count()) !== n) throw new Error(`at ${width}px every permission row has its own Copy button (${n} rows)`);
        if (!(await page.locator('[data-testid="ghl-scope-rows"]').innerText()).includes("GoHighLevel adds permissions one at a time")) throw new Error(`at ${width}px the one-at-a-time line is above the rows`);
        await page.locator('[data-testid="ghl-scope-tick"]').nth(0).check();
        await page.locator('[data-testid="ghl-scope-tick"]').nth(1).check();
        if (!(await page.locator('[data-testid="ghl-scope-count"]').innerText()).startsWith(`2 of ${n} added`)) throw new Error(`at ${width}px the ticks count: ${await page.locator('[data-testid="ghl-scope-count"]').innerText()}`);
        if (await rows.first().evaluate((el) => el.getBoundingClientRect().right > window.innerWidth)) throw new Error(`at ${width}px a row never runs off the screen`);
        // H-294: a row's Copy puts the scope id alone on the clipboard, exactly as the row shows it, and says so; the list copy is every id, one a line.
        const { GHL_SCOPES, scopeList } = await import("@/lib/engine/ghl-scopes");
        for (const i of [0, 13, n - 1]) {
          const row = rows.nth(i);
          const id = (await row.getAttribute("data-scope")) ?? "";
          if (!id || (await row.locator('[data-testid="ghl-scope-id"]').innerText()).trim() !== id) throw new Error(`at ${width}px row ${i} shows its scope id in monospace`);
          await row.locator('[data-testid="ghl-scope-copy"]').click();
          const got = await page.evaluate("navigator.clipboard.readText()");
          if (got !== id) throw new Error(`at ${width}px row ${i}'s Copy puts the id alone on the clipboard: ${JSON.stringify(got)} vs ${id}`);
          if ((await row.locator('[data-testid="ghl-scope-copy"]').innerText()).trim() !== `Copied ${id}`) throw new Error(`at ${width}px the button says Copied ${id}`);
        }
        await page.locator('[data-testid="ghl-scope-copy-list"]').click();
        const list = await page.evaluate("navigator.clipboard.readText()");
        if (list !== scopeList(GHL_SCOPES) || list.split("\n").length !== n || /\n$/.test(list)) throw new Error(`at ${width}px Copy the list is every id, one a line, no trailing newline`);
        console.log(`✓ at ${width}px: one Copy per permission (the id alone), the id beside the name, the list copy one id a line, the tick count, nothing wider than the screen`);
      }
    } finally {
      if (ghlRow) await db.insert(schema.socialConnections).values(ghlRow);
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    // The coach: GHL and CL at a glance with the date, and the setup link.
    await signIn("coach");
    await page.goto(`${base}/coach?connections=open`);
    const mine = page.locator(`details[data-testid="client-connections"][data-member="${membership.id}"]`);
    await mine.waitFor({ timeout: 20000 });
    const chip = mine.locator('[data-testid="chip-cl"]');
    if ((await chip.getAttribute("data-on")) !== "1" || !/CL ✓ [A-Z][a-z]{2} \d{1,2}/.test(await chip.innerText())) throw new Error(`the coach's row says CL ✓ with the date: ${await chip.innerText()}`);
    if ((await page.content()).includes(GOOD)) throw new Error("the coach never sees the key");
    const linkForm = mine.locator('[data-testid="send-connect-link"]');
    if (await linkForm.count()) {
      await submit(page, `details[data-testid="client-connections"][data-member="${membership.id}"] [data-testid="send-connect-link"] button`);
      await mine.locator('[data-testid="connect-link-sent"]').waitFor({ timeout: 15000 });
      if (!(await row()).connectLinkSentAt) throw new Error("the setup link is dated");
      console.log("✓ the coach sees CL ✓ with its date, never the key, and sends the setup link (dated on the row)");
    } else console.log("✓ the coach sees CL ✓ with its date, never the key; both connected, so no setup link to send");

    // Remove key clears it.
    await signIn("client");
    await page.goto(`${base}/connect-tools`);
    page.once("dialog", (d) => d.accept());
    await submit(page, '[data-testid="cl-remove"] button');
    await page.locator('[data-testid="cl-not-connected"]').waitFor({ timeout: 15000 });
    const gone = await row();
    if (gone.clApiToken || gone.clConnectedAt) throw new Error("Remove key clears the key and its date");
    console.log("✓ Remove key clears it from HelixOS");
  } finally {
    await db.update(schema.memberships).set(before).where(eq(schema.memberships.id, membership.id));
    await fetch(`${mock}/__reset`, { method: "POST" }).catch(() => null);
    await browser.close();
    if (proc?.pid) try { process.kill(-proc.pid); } catch { /* already gone */ }
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Connect your tools smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
