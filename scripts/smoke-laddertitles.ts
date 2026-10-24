/**
 * The Ladders list reads (H-1941, plan H-1946): a ladder named "SKIN — Method / Resource — <a 70-character topic>" shows in
 * the list at the bottom of /content/ladders as the topic only, on its own line, wrapping between words: at 1440 and at 390
 * wide the title box is at least 14rem, no rendered line holds fewer than 10 characters, the meta row sits under the title,
 * and nothing scrolls sideways. The seeded "SKIN — Mistakes Ladder — …" ladder reads without its prefix too. The test
 * ladder is removed after.
 */
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
const TOPIC = "The $1,000 first-gear offer that moves buyers toward $12,000 in a month";

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
}

/** The title's rendered lines: how many characters land on each line box, from one range per character. */
async function lineLengths(page: Page, id: string): Promise<number[]> {
  return page.evaluate((ladderId) => {
    const a = document.querySelector(`a[data-testid="ladder-row-title"][href="/content/ladders/${ladderId}"]`)!;
    const node = a.firstChild as Text;
    const text = node.textContent ?? "";
    const tops = new Map<number, number>();
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " ") continue;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const top = Math.round(r.getBoundingClientRect().top);
      tops.set(top, (tops.get(top) ?? 0) + 1);
    }
    return [...tops.entries()].sort((x, y) => x[0] - y[0]).map(([, n]) => n);
  }, id);
}

async function check(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}/content/ladders?look=${width}`);
  const title = page.locator(`a[data-testid="ladder-row-title"][href="/content/ladders/${id}"]`);
  await title.waitFor({ timeout: 30000 });
  const text = (await title.innerText()).trim();
  must(text === TOPIC, `at ${width} the title reads as the topic only (${text})`);
  const box = (await title.boundingBox())!;
  must(box.width >= 224, `at ${width} the title box is at least 14rem wide (${Math.round(box.width)}px)`);
  const lines = await lineLengths(page, id);
  must(lines.every((n) => n >= 10) || lines.length === 1, `at ${width} no line holds fewer than 10 characters (${lines.join(", ")})`);
  const row = title.locator("xpath=..");
  const meta = row.locator("div").first();
  const metaBox = (await meta.boundingBox())!;
  must(metaBox.y >= box.y + box.height - 1, `at ${width} the meta row sits under the title`);
  const [sw, cw] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, document.scrollingElement!.clientWidth]);
  must(sw <= cw + 1, `at ${width} nothing scrolls sideways (${sw} > ${cw})`);
  console.log(`✓ at ${width}: the title reads as the topic, ${lines.length} line${lines.length === 1 ? "" : "s"} of ${lines.join("/")} characters, ${Math.round(box.width)}px wide, meta underneath`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq } = await import("drizzle-orm");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const id = newId();
  await db.insert(schema.ladders).values({ id, workspaceId: mm.workspaceId, userId: maya.id, format: "method_resource", topic: TOPIC, postName: `SKIN — Method / Resource — ${TOPIC}`, keyword: "NONE" });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext()).newPage();
    await login(page);
    await check(page, id, 1440);
    await check(page, id, 390);
    const all = (await page.getByTestId("ladder-row-title").allInnerTexts()).map((t) => t.trim());
    must(!all.some((t) => /^SKIN\b/i.test(t)), `no title in the list starts with SKIN (${all.filter((t) => /^SKIN/i.test(t)).join("; ")})`);
    const seeded = await db.query.ladders.findFirst({ where: and(eq(schema.ladders.userId, maya.id), eq(schema.ladders.postName, "SKIN — Mistakes Ladder — quit by week three")) });
    if (seeded) {
      must(all.includes("quit by week three"), "the seeded Mistakes ladder reads as its topic");
      console.log("✓ the seeded \"SKIN — Mistakes Ladder — quit by week three\" reads as \"quit by week three\"");
    }
  } finally {
    await browser.close();
    await db.delete(schema.ladders).where(eq(schema.ladders.id, id));
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
