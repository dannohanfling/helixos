/**
 * Evidence: each client builds their own shelf of published research. The claim comes first and the model proposes the
 * terms; OpenAlex answers server-side on one shared key that never reaches the browser; results carry the citation count,
 * the year and a working DOI, sorted and flagged, never auto-decided; nothing is citable until the client confirms what they
 * asked for against what came back; the shared starter shelf is labelled Evolve Omega's and removable per client; a
 * fabricated statistic blocks with its why and say-instead, never a bare refusal. Runs against scripts/mock-openalex.ts and
 * scripts/mock-ai.ts; the dev server must be started with OPENALEX_BASE_URL=http://localhost:4040, OPENALEX_API_KEY=test-key and
 * AI_BASE_URL=http://localhost:4020.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const openalexPort = 4040;
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
async function login(page: Page, who: "client" | "coach") {
  await page.goto(`${base}/settings`).catch(() => null);
  if (await page.locator('button:has-text("Log out")').count()) {
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
  } else await page.goto(`${base}/login`);
  await page.click(who === "client" ? 'button:has-text("As a client")' : 'button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
const calls = async () => ((await (await fetch(`http://localhost:${openalexPort}/__calls`)).json()) as { calls: number }).calls;
const lastSystem = async () => ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { system: { text: string }[] }).system.map((b) => b.text).join("\n\n");

async function main() {
  const openalex = spawn("npx", ["tsx", "scripts/mock-openalex.ts", String(openalexPort)], { stdio: "ignore", detached: true });
  const ai = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const browserRequests: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("request", (r) => browserRequests.push(r.url()));
    await login(page, "client");

    // The section, its one-line description, and the Proof Bank's, so the two are not confused
    await page.goto(`${base}/evidence`);
    await expectText(page, "Published research", "evidence page");
    const nav = await page.locator('nav a[href="/evidence"]').first().innerText();
    if (!/published research/i.test(nav)) throw new Error(`nav must say what Evidence is: "${nav}"`);
    const proofNav = await page.locator('nav a[href="/proof"]').first().innerText();
    if (!/your clients' results/i.test(proofNav)) throw new Error(`nav must say what the Proof Bank is: "${proofNav}"`);
    console.log("✓ Evidence in the nav, one line under each of Evidence and Proof Bank");

    // The shared starter shelf: nine, labelled Evolve Omega's, each with a working DOI link, the two featured ones named
    const shared = page.locator('[data-testid="shared-study"]');
    if ((await shared.count()) !== 9) throw new Error(`expected 9 shared studies, got ${await shared.count()}`);
    await expectText(page, "shared · sourced by Evolve Omega", "shared label");
    if ((await page.locator('[data-testid="shared-study"] a[href^="https://doi.org/10."]').count()) !== 9) throw new Error("every shared study must link its DOI");
    await expectText(page, "Behind the comment ladder", "s13 featured");
    await expectText(page, "Behind the pre-webinar activation videos", "s09 featured");
    console.log("✓ shared starter shelf: 9 studies, labelled, DOI-linked, two featured");

    // No key, no model: the claim's own words stand in, and the page says so
    await fillExact(page, 'textarea[name="claim"]', "Hypnotherapy helps people quit smoking.");
    await submit(page, 'button:has-text("Propose search terms")');
    await page.locator('[data-testid="terms-fallback"]').waitFor({ timeout: 5000 });
    const fallback = await page.locator('[data-testid="terms-input"]').inputValue();
    if (fallback !== "hypnotherapy, quit, smoking") throw new Error(`fallback terms should be the claim's words, got "${fallback}"`);
    console.log("✓ without an AI key the terms are the claim's own words, and it says so");

    // With a key: the model turns the claim into terms and names the effect and field
    await page.goto(`${base}/settings`);
    await page.selectOption('select[name="provider"]', "anthropic");
    await page.fill('input[name="key"]', "sk-ant-good");
    await submit(page, 'button:has-text("Connect and check"), button:has-text("Replace and check")');
    await page.goto(`${base}/evidence`);
    await fillExact(page, 'textarea[name="claim"]', "A small yes makes a bigger yes easier later.");
    await fillExact(page, 'input[name="author"]', "Freedman");
    await fillExact(page, 'input[name="year"]', "1966");
    await submit(page, 'button:has-text("Propose search terms")');
    await page.locator('[data-testid="terms-note"]').waitFor({ timeout: 5000 });
    await expectText(page, "Foot-in-the-door effect", "effect named");
    const terms = await page.locator('[data-testid="terms-input"]').inputValue();
    if (!/foot-in-the-door/.test(terms)) throw new Error(`proposed terms should come from the model, got "${terms}"`);
    console.log(`✓ the claim became terms: "${terms}"`);

    // Search: real papers, most cited first, year and DOI shown, the wrong-year one flagged and never auto-decided
    const before = await calls();
    await submit(page, 'button:has-text("Search OpenAlex")');
    await page.locator('[data-testid="results"]').waitFor({ timeout: 10000 });
    const rows = page.locator('[data-testid="result"]');
    if ((await rows.count()) !== 3) throw new Error(`expected 3 results, got ${await rows.count()}`);
    const citedOrder = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-cited"))));
    if (citedOrder.join(",") !== "1624,1187,3") throw new Error(`results must be sorted by citations, got ${citedOrder.join(",")}`);
    await expectText(page, "cited 1,624 times", "citation count");
    if (!(await page.locator('[data-testid="result"] a[href="https://doi.org/10.1037/h0023552"]').count())) throw new Error("the DOI must be a working link");
    const flagged = page.locator('[data-testid="result"][data-flagged="1"]');
    if ((await flagged.count()) < 1) throw new Error("the 2014 self-affirmation paper must be flagged");
    await expectText(page, "Year differs: you asked for 1966, this is 2014.", "year flag");
    if ((await rows.first().getAttribute("data-flagged")) !== "0") throw new Error("the right paper must not be flagged");
    if ((await calls()) !== before + 1) throw new Error("one search is one OpenAlex call");
    console.log("✓ results: sorted by citations, year and DOI shown, the wrong paper flagged, the right one not");

    // The key never reaches the browser
    if (browserRequests.some((u) => u.includes(`:${openalexPort}`) || u.includes("openalex") || u.includes("api_key"))) throw new Error("the browser must never call OpenAlex or carry the key");
    if (/test-key/.test(await page.content())) throw new Error("the OpenAlex key must never appear in a page");
    console.log("✓ OpenAlex is called server-side only; the key never reaches the browser");

    // The same terms again this week come from the cache: no second call
    const searchUrl = page.url();
    await page.goto(`${base}/evidence?claim=${encodeURIComponent("A small yes makes a bigger yes easier later.")}&terms=${encodeURIComponent(terms)}&author=Freedman&year=1966`);
    const beforeCache = await calls();
    await submit(page, 'button:has-text("Search OpenAlex")');
    await expectText(page, "from this week's cache", "cache badge");
    if ((await calls()) !== beforeCache) throw new Error("a repeated query must be answered from the cache, not OpenAlex");
    console.log("✓ a repeated query is one call, not two");

    // Out of quota fails visibly and says when it resets; it never reads as "no research exists"
    await page.goto(`${base}/evidence?claim=x&terms=quota`);
    await submit(page, 'button:has-text("Search OpenAlex")');
    await page.locator('[data-testid="evidence-error"]').waitFor({ timeout: 5000 });
    await expectText(page, "out of quota for today", "quota message");
    await expectText(page, "midnight UTC", "quota reset");
    if (await page.locator('[data-testid="no-results"]').count()) throw new Error("a quota failure must not look like an empty result");
    console.log("✓ quota exhaustion is said plainly, with the reset time");

    // Picking the wrong paper: unverified, what was asked for beside what came back, the flag on the row; removable
    await page.goto(searchUrl);
    await submit(page, '[data-testid="result"][data-flagged="1"] button:has-text("Add to my shelf")');
    const unverified = page.locator('[data-testid="own-study"][data-quality="unverified"]');
    await unverified.first().waitFor({ timeout: 5000 });
    await expectText(page, "Not citable until you confirm", "unverified state");
    const side = await page.locator('[data-testid="side-by-side"]').first().innerText();
    if (!/You asked for/.test(side) || !/Freedman, 1966/.test(side) || !/Found/.test(side) || !/2014/.test(side) || !/cited 1,187 times/.test(side)) throw new Error(`side by side should show the ask beside the result:\n${side}`);
    await expectText(page, "Year differs: you asked for 1966, this is 2014.", "flag on the shelf row");
    if (await page.locator('[data-testid="own-study"] button:has-text("Copy claim + citation")').count()) throw new Error("an unverified study must not be copyable as a citation");
    await submit(page, '[data-testid="own-study"][data-quality="unverified"] button:has-text("Not it, remove")');
    if (await page.locator('[data-testid="own-study"]').count()) throw new Error("removing the wrong paper should empty the shelf");
    console.log("✓ the wrong paper: unverified, shown beside the ask, flagged, not citable, removed");

    // Picking the right one and confirming: the client's confirmation, and only that, makes it citable
    await page.goto(searchUrl);
    await submit(page, '[data-testid="result"][data-flagged="0"] button:has-text("Add to my shelf")');
    await page.locator('[data-testid="own-study"][data-quality="unverified"]').first().waitFor({ timeout: 5000 });
    await submit(page, '[data-testid="confirm-study"]');
    await page.locator('[data-testid="own-study"][data-quality="verified"]').first().waitFor({ timeout: 5000 });
    await expectText(page, "verified · citable", "verified badge");
    await expectText(page, "1 confirmed and citable", "header count");
    if (!(await page.locator('[data-testid="own-study"] button:has-text("Copy claim + citation")').count())) throw new Error("a verified study must be copyable, claim and citation together");
    console.log("✓ the right paper: confirmed by the client, now citable");

    // Removing a shared study changes this client's shelf only
    await submit(page, '[data-testid="shared-study"][data-id="s01"] [data-testid="hide-shared"]');
    if ((await page.locator('[data-testid="shared-study"]').count()) !== 8) throw new Error("removing a shared study should leave 8 on this shelf");
    await expectText(page, "1 removed from your shelf", "removed count");
    console.log("✓ a shared study removed from one shelf");

    // The ladder: the shelf feeds the prompt (verified only, claim and citation together) and sits beside the rungs
    await page.goto(`${base}/content/ladders`);
    await fillExact(page, 'input[name="topic"]', "Why the hand raise comes before the offer");
    await submit(page, 'button:has-text("Write the ladder")');
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+/i);
    const sys = await lastSystem();
    if (!/## VERIFIED EVIDENCE — USE ONLY THESE/.test(sys) || !/Freedman/.test(sys) || !/10\.1037\/h0023552/.test(sys)) throw new Error("the ladder prompt must carry the client's verified evidence, claim and citation together");
    if (/Mere Exposure|10\.1037\/h0025848/.test(sys)) throw new Error("a shared study the client removed must not reach their prompt");
    if (/Self-Affirmation/.test(sys)) throw new Error("an unconfirmed study must never reach a prompt");
    const ladderEvidence = page.locator('[data-testid="ladder-evidence"] li');
    if ((await ladderEvidence.count()) !== 9) throw new Error(`ladder should list 8 shared + 1 own studies, got ${await ladderEvidence.count()}`);
    if (!(await page.locator('[data-testid="ladder-evidence"] li[data-source="own"]').count())) throw new Error("the client's own verified study must be on the ladder page");
    console.log("✓ the ladder prompt and page carry the client's citable evidence, and nothing unconfirmed or removed");

    // The blacklist blocks a fabricated statistic on the ladder, with the why and the say-instead
    const copy = await page.locator('textarea[name="copy"]').inputValue();
    await fillExact(page, 'textarea[name="copy"]', `${copy}\nIt takes 21 days to form a habit.`);
    await submit(page, 'button:has-text("Save and re-check")');
    const check = page.locator('[data-testid="checklist"] li[data-check="fabricated"]');
    if ((await check.getAttribute("data-ok")) !== "0") throw new Error("a fabricated statistic must fail the checklist");
    const checkText = await check.innerText();
    if (!/Psycho-Cybernetics/.test(checkText) || !/Say instead: Habits take longer than people expect/.test(checkText)) throw new Error(`the block must show the why and the say-instead:\n${checkText}`);
    await fillExact(page, 'textarea[name="copy"]', copy);
    await submit(page, 'button:has-text("Save and re-check")');
    if ((await check.getAttribute("data-ok")) !== "1") throw new Error("the block should clear once the claim is gone");
    console.log("✓ ladder: a fabricated statistic blocks publishing and explains itself");

    // And in the composer: blocked at once, why and say-instead beside the draft, scheduling disabled
    await page.goto(`${base}/content/compose`);
    await page.fill('textarea[placeholder^="Type content"]', "The Yale goals study proved that writing goals down works.\nWhat would you try first?");
    await page.locator('[data-testid="fabricated-block"]').first().waitFor({ timeout: 5000 });
    const block = await page.locator('[data-testid="fabricated-block"]').first().innerText();
    if (!/does not exist/.test(block) || !/Say instead: Gail Matthews/.test(block)) throw new Error(`composer block must carry the why and the say-instead:\n${block}`);
    if (!(await page.locator('button:has-text("Schedule")').first().isDisabled())) throw new Error("scheduling must be disabled while a fabricated statistic is in a draft");
    await page.fill('textarea[placeholder^="Type content"]', "Gail Matthews' Dominican University study found written goals plus accountability improved achievement.\nWhat would you try first?");
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="fabricated-block"]').count()) throw new Error("a true claim must not be blocked");
    console.log("✓ composer: blocked with the why and the say-instead, cleared with a true line");

    // The webinar wizard's script step offers the same shelf
    await page.goto(`${base}/webinars`);
    await page.click('main a[href^="/webinars/"]');
    await page.waitForURL(/\/webinars\/[a-z0-9-]+/i);
    await page.goto(page.url().split("?")[0] + "?step=script");
    if (!(await page.locator('[data-testid="webinar-evidence"] li').count())) throw new Error("the webinar script step must list the client's citable evidence");
    console.log("✓ webinar wizard lists the shelf beside the proof");

    // Another client's shelf is untouched: the coach sees all nine shared studies and none of the client's own
    await login(page, "coach");
    await page.goto(`${base}/evidence`);
    if ((await page.locator('[data-testid="shared-study"]').count()) !== 9) throw new Error("removing a shared study from one shelf must not touch another");
    if (await page.locator('[data-testid="own-study"]').count()) throw new Error("one client's own evidence must never appear for another");
    console.log("✓ each shelf is its own: the coach's has all nine and none of the client's");
  } finally {
    await browser.close();
    try {
      process.kill(-openalex.pid!);
    } catch {}
    try {
      process.kill(-ai.pid!);
    } catch {}
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Evidence smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
