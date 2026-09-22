/**
 * Deletes, read on the live app on 22 Sep: deleting a post left the person on the deleted post's own address, a bare 404, with
 * no confirmation before or after. The walk takes the same path. A post is opened and Delete pressed: the app's own confirm says
 * what will go and that it cannot be undone, Cancel is focused (Enter and Escape both cancel and nothing is sent), then Delete
 * sends. The person lands on the list, never the old address, with one short line saying what went, and the line is taken off
 * the address so a reload does not repeat it. The old address then answers with the plain "isn't here anymore" line, inside the
 * app's layout, with the way back to its list. Every detail route in the app is swept the same way with an id that does not
 * exist: each has its own not-found page (checked on disk) and answers with the plain line and a link to its own list. The
 * routes come from src/app, never a list typed here. Run with the dev server up.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const APP = join(__dirname, "..", "src", "app", "(app)");

/** Every detail page under the app layout: a page.tsx under a dynamic segment, as its route pattern. */
function detailRoutes(): { pattern: string; dir: string }[] {
  const out: { pattern: string; dir: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx" && /\[[^\]]+\]/.test(relative(APP, p))) out.push({ pattern: `/${relative(APP, dirname(p)).split("\\").join("/")}`, dir: dirname(p) });
    }
  };
  walk(APP);
  return out.sort((a, b) => a.pattern.localeCompare(b.pattern));
}
/** The not-found page a route answers with: its own segment's, else the nearest ancestor's inside the app layout. */
function notFoundFor(dir: string): string | null {
  for (let d = dir; d.startsWith(APP); d = dirname(d)) if (existsSync(join(d, "not-found.tsx"))) return join(d, "not-found.tsx");
  return null;
}

async function signIn(page: Page, who: "client" | "coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
  await page.waitForURL(/\/today/);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const { DELETED_MESSAGES } = await import("@/lib/deleted");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await signIn(page, "client");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const ws = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!.workspaceId;
    const id = randomUUID();
    const title = `A test post to delete ${id.slice(0, 8)}`;
    await db.insert(schema.contentItems).values({ id, workspaceId: ws, userId: maya.id, title });
    const exists = async () => Boolean(await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) }));

    // ── The confirm: what will go, that it cannot be undone, Cancel the default. ──
    await page.goto(`${base}/content/${id}`);
    const trigger = page.locator(`form:has(input[name="id"][value="${id}"]) button:has-text("Delete")`).first();
    await trigger.waitFor({ timeout: 20000 });
    await trigger.click();
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor({ timeout: 5000 });
    const words = await dialog.innerText();
    if (!/Delete this post\?/.test(words) || !/This can't be undone\./.test(words)) throw new Error(`the confirm says what goes and that it cannot be undone, got "${words}"`);
    const buttons = (await dialog.locator("button").allInnerTexts()).map((b) => b.trim());
    if (JSON.stringify(buttons) !== JSON.stringify(["Cancel", "Delete"])) throw new Error(`the confirm offers Cancel and Delete, got ${JSON.stringify(buttons)}`);
    if ((await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid)) !== "confirm-delete-cancel") throw new Error("Cancel is the default: it has the focus when the confirm opens");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    if ((await dialog.count()) || !(await exists()) || !page.url().endsWith(`/content/${id}`)) throw new Error("Enter on the default cancels: nothing sent, the post still there");
    await trigger.click();
    await dialog.waitFor({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    if ((await dialog.count()) || !(await exists())) throw new Error("Escape cancels: nothing sent, the post still there");
    console.log(`✓ the confirm: "${words.split("\n")[0]}" with "This can't be undone.", Cancel and Delete, Cancel focused; Enter and Escape both cancel`);

    // ── Delete: back to the list, never the old address, with one short line; a reload does not say it again. ──
    await trigger.click();
    await dialog.waitFor({ timeout: 5000 });
    await Promise.all([page.waitForURL(/\/content(\?|$)/), dialog.locator('[data-testid="confirm-delete-yes"]').click()]);
    if (await exists()) throw new Error("Delete deletes the post");
    const notice = page.locator('[data-testid="deleted-notice"]');
    await notice.waitFor({ timeout: 10000 });
    if ((await notice.innerText()).trim() !== DELETED_MESSAGES.post) throw new Error(`the list says what went, got "${await notice.innerText()}"`);
    await page.waitForFunction(() => !location.search.includes("deleted="), null, { timeout: 5000 });
    if (new URL(page.url()).pathname !== "/content") throw new Error(`the person is on the list, got ${page.url()}`);
    await page.reload();
    await page.locator("main").waitFor();
    if (await notice.count()) throw new Error("a reload does not repeat the line");
    console.log(`✓ after Delete: on /content with "${DELETED_MESSAGES.post}", the address cleaned, and a reload does not repeat it`);

    // ── The old address: the plain line inside the app, and the way back to the list. ──
    await page.goto(`${base}/content/${id}`);
    const gone = page.locator('[data-testid="item-gone"]');
    await gone.waitFor({ timeout: 20000 });
    if (!/This post isn't here anymore\./.test(await gone.innerText())) throw new Error(`the old address says so plainly, got "${await gone.innerText()}"`);
    if ((await gone.locator('[data-testid="item-gone-back"]').getAttribute("href")) !== "/content") throw new Error("the old address links back to its list");
    if (!(await page.locator('[data-testid="logout-sidebar"]').count())) throw new Error("the layout stays: the app's own sidebar is there");
    console.log("✓ the old address: \"This post isn't here anymore.\" inside the app, with Back to your posts");

    // ── Every detail route: its own not-found page, and a missing id answers with the plain line and its list. ──
    const routes = detailRoutes();
    if (routes.length < 12) throw new Error(`the detail routes are read from src/app: found ${routes.length}`);
    let swept = 0;
    const coachPage = await (await browser.newContext()).newPage();
    await signIn(coachPage, "coach");
    for (const r of routes) {
      const nf = notFoundFor(r.dir);
      if (!nf) {
        failures.push(`${r.pattern} has no not-found page of its own or above it inside the app`);
        continue;
      }
      const href = readFileSync(nf, "utf8").match(/href="([^"]+)"/)?.[1];
      const who = r.pattern.startsWith("/coach/") ? coachPage : page;
      await who.goto(`${base}${r.pattern.replace(/\[[^\]]+\]/g, randomUUID())}`);
      const box = who.locator('[data-testid="item-gone"]');
      await box.waitFor({ timeout: 30000 }).catch(() => undefined);
      const text = (await box.count()) ? await box.innerText() : "";
      const link = (await box.count()) ? await box.locator('[data-testid="item-gone-back"]').getAttribute("href") : null;
      if (!/isn't here anymore\./.test(text) || !href || link !== href) failures.push(`${r.pattern}: a missing id answers "${text.split("\n")[0]}" linking ${link}, not the plain line and ${href}`);
      else swept++;
    }
    if (swept !== routes.length) throw new Error(`every detail route answers a missing id plainly: ${swept} of ${routes.length}\n${failures.join("\n")}`);
    console.log(`✓ all ${routes.length} detail routes (read from src/app) answer a missing id with the plain line and a link to their own list`);

    if (failures.length) throw new Error(`failures: ${failures.join(", ")}`);
    console.log("Deletes walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
