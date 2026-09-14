/** Socrates Domain: seven lessons in order with no task machinery, the question library filtered by beat and script type plus a client's own question, the grouped reframes with the restored credit, and the pick-or-write script wizard to a finished, copyable script. Run with the dev server up. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

const base = process.argv[2] ?? "http://localhost:3000";
mkdirSync("screenshots", { recursive: true });

async function expectText(page: Page, text: string, label: string) {
  const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // A page answers at once with its loading skeleton; it must clear within 3 seconds, then the text must be there.
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
/** A fill right after navigation can land mid-hydration and merge with the old value; write until the field holds exactly this. */
async function fillExact(page: Page, selector: string, value: string) {
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`could not set ${selector} to the expected text`);
}
const ATTRIBUTION = "I paid for and studied Jeremy Miner's NEPQ and Matt Ryder's Sales Sniper. SocratesOS is my own framework, built from what they taught me. Where a specific idea is someone else's — like Alex Hormozi's \"shoulder to shoulder\" — it's credited where it appears.";

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => failures.push(`pageerror ${e.message}`));
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // Foundations: seven lessons in order, both side blocks present, the build note kept off the page, no task machinery, the attribution word for word
    await page.click('nav a:has-text("Foundations")');
    await page.waitForURL(/\/socrates\/foundations/);
    await expectText(page, "Welcome to SocratesOS", "lesson 1");
    const orders = await page.locator('[data-testid="lesson"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-order")));
    if (orders.join(",") !== "1,2,3,4,5,6,7") throw new Error(`lessons out of order: ${orders.join(",")}`);
    if ((await page.locator('[data-testid="sounds-like"]').count()) !== 7 || (await page.locator('[data-testid="why-it-matters"]').count()) !== 7) throw new Error("every lesson needs its Why it matters and Sounds like blocks");
    const body = await page.locator("main").innerText().catch(() => page.locator("body").innerText());
    if (/Note for the app build/.test(body)) throw new Error("the build note in lesson 4 must not be shown to a client");
    if (!body.includes("Your reframe library is where this layer lives")) throw new Error("lesson 4 must close on Danno's sentence about the reframe library");
    if (!body.includes("Clarify → Discuss → Diffuse")) throw new Error("lesson 6 missing");
    if (/Mark done|Done ✓|\+\d+ pts|points/i.test(body)) throw new Error("lessons must carry no done button, score or points");
    const attribution = (await page.locator('[data-testid="socrates-attribution"]').innerText()).replace(/\s+/g, " ").trim();
    if (attribution !== ATTRIBUTION) throw new Error(`attribution differs from the approved line:\n${attribution}`);
    await page.screenshot({ path: "screenshots/s01-foundations.png", fullPage: true });
    console.log("✓ foundations: 7 lessons in order, no task machinery, attribution verbatim, build note kept off the page");

    // Question library: 45, filtered by beat and by script type; a client's own question is theirs
    await page.goto(`${base}/socrates/questions`);
    await expectText(page, "45 in the library", "library count");
    if ((await page.locator('[data-testid="question-row"]').count()) !== 45) throw new Error("expected 45 library questions");
    await page.click('a:has-text("A · Areas of Friction")');
    await page.waitForURL(/stage=/);
    await page.locator('[data-testid="question-row"]').first().waitFor();
    if ((await page.locator('[data-testid="question-row"]').count()) !== 10) throw new Error("Areas of Friction should list 10");
    await page.goto(`${base}/socrates/questions?stage=${encodeURIComponent("I — Implications")}&type=DM`);
    await page.locator('[data-testid="no-questions"]').waitFor({ timeout: 10000 });
    await page.goto(`${base}/socrates/questions?stage=${encodeURIComponent("T — Tailor the Solution")}&type=DM`);
    await page.locator('[data-testid="question-row"]').first().waitFor();
    if ((await page.locator('[data-testid="question-row"]').count()) !== 1) throw new Error("Tailor the Solution × DM should list exactly q13");
    await page.click('summary:has-text("Add your own question")');
    await fillExact(page, '[data-testid="add-question"] input[name="question"]', "Walk-test: what would [the bridge] look like for you?");
    await page.check('[data-testid="add-question"] input[name="scriptTypes"][value="DM"]');
    await submit(page, '[data-testid="add-question"] button:has-text("Add question")');
    await page.waitForURL(/stage=T/);
    await expectText(page, "Walk-test: what would", "own question listed");
    await expectText(page, "1 of your own", "own count");
    if ((await page.locator('[data-testid="question-row"][data-own="1"]').count()) !== 1) throw new Error("own question must be marked as the client's");
    await page.screenshot({ path: "screenshots/s02-questions.png", fullPage: true });
    console.log("✓ question library: 45, filters by beat and script type, own question added");

    // Objections: one record. The shared set is Evolve Omega's with its belief mapping; a client's own carries what is underneath,
    // which belief, and several reframes; the method is not shown until its words exist.
    await page.goto(`${base}/socrates/objections`);
    await expectText(page, "shared · Evolve Omega", "shared objections label");
    if ((await page.locator('[data-testid="shared-objection"]').count()) < 19) throw new Error("the shared starter set must list the template's objections");
    if ((await page.locator('[data-testid="shared-objection"][data-name="I\'ve tried this kind of thing before"]').getAttribute("data-belief")) !== "vehicle") throw new Error("the seed's belief mapping must show on the shared set");
    await expectText(page, "Don't answer it yet.", "method step one");
    if ((await page.locator('[data-testid="objection-method"] li').count()) !== 6) throw new Error("six steps");
    const loop = page.locator('[data-testid="loop-line"]');
    await loop.waitFor({ timeout: 5000 });
    if ((await loop.getAttribute("data-from")) !== "method-step-check" || (await loop.getAttribute("data-to")) !== "method-step-find") throw new Error("the loop is drawn from step 5 back to step 2");
    if (!(await loop.locator("path[marker-end]").count())) throw new Error("the loop line carries an arrowhead");
    await fillExact(page, '[data-testid="new-objection-name"]', "I need to run it past my business partner");
    await fillExact(page, '[data-testid="new-objection-underneath"]', "They don't want to be the one who decided alone.");
    await page.selectOption('[data-testid="new-objection-belief"]', "none");
    await page.locator('[data-testid="new-objection-reframe"]').nth(0).fill("Bring them to the call.");
    await page.locator('[data-testid="new-objection-reframe"]').nth(1).fill("What would they need to hear?");
    await submit(page, 'button:has-text("Save to my objections")');
    const own = page.locator('[data-testid="own-objections"] [data-testid="objection"]');
    if ((await own.count()) !== 1 || (await own.first().getAttribute("data-belief")) !== "none") throw new Error("the client's own objection should be saved with belief none");
    await expectText(page, "2 reframes", "several reframes on one record");
    console.log("✓ objections: shared set with belief mapping, own record with underneath, belief and two reframes, method shown with the loop drawn from step 5 back to step 2");

    // Reframes: three objection groups of spoken lines, 3 / 3 / 3, the two posture principles apart with no copy-to-prospect
    // button, the Hormozi credit on Shoulder to Shoulder; what Copy puts on the clipboard is the line, exactly, no backslash
    await page.goto(`${base}/socrates/reframes`);
    await expectText(page, "Leaky Pipe", "reframes");
    const groups = await page.locator('[data-testid="reframe-group"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-group")}=${e.querySelectorAll('[data-testid="reframe"]').length}`));
    if (groups.join("|") !== "Price / too expensive=3|No time / too busy=3|Needs a partner's sign-off=3") throw new Error(`reframe groups wrong: ${groups.join("|")}`);
    if ((await page.locator('[data-testid="reframe-principles"] [data-testid="reframe"][data-type="principle"]').count()) !== 2) throw new Error("the two principles sit apart under Posture");
    if ((await page.locator('[data-testid="reframe-principles"] button:text-is("Copy")').count()) !== 0) throw new Error("a principle has no copy-to-prospect button");
    if ((await page.locator('[data-testid="reframe-principles"] button:has-text("Copy note to self")').count()) !== 2) throw new Error("a principle copies only as a note to self");
    if ((await page.locator('[data-testid="reframe"][data-id="r01"]').count()) !== 1) throw new Error("r01 renders once");
    const credit = await page.locator('[data-testid="reframe"][data-id="r11"] [data-testid="reframe-credit"]').innerText();
    if (!credit.includes("Alex Hormozi")) throw new Error("Shoulder to Shoulder must credit Alex Hormozi where it appears");
    const clipText = async () => page.evaluate(() => navigator.clipboard.readText());
    await page.locator('[data-testid="reframe"][data-id="r01"]').locator("xpath=ancestor::section[1]").locator('button:text-is("Copy")').click();
    const one = await clipText();
    if (one !== "Can I show you the way I'd look at that? Don't look only at the repair bill. Look at the leak. If there's a leak in a pipe at your house, you can avoid paying to fix it today — but the leak keeps costing you every day it stays there.") throw new Error(`one reframe copies clean: ${JSON.stringify(one)}`);
    if (one.includes("\\")) throw new Error("no backslash on the clipboard");
    await page.locator('[data-testid="reframe"][data-id="r01"]').locator("xpath=ancestor::section[1]").locator('[data-testid="reframe-pick"]').check();
    await page.locator('[data-testid="reframe"][data-id="r04"]').locator("xpath=ancestor::section[1]").locator('[data-testid="reframe-pick"]').check();
    await page.locator('[data-testid="reframe-copy-bar"] button:has-text("Copy 2")').click();
    const two = await clipText();
    if (!two.startsWith("Price / too expensive — Leaky Pipe\n") || !two.includes("\n\nNo time / too busy — Sharpening the Axe\n")) throw new Error(`several copy under their headings: ${JSON.stringify(two)}`);
    await page.locator('[data-testid="reframe"][data-id="r11"]').locator("xpath=ancestor::section[1]").locator('button:has-text("Copy note to self")').click();
    if (!(await clipText()).endsWith("Credit: Alex Hormozi — “shoulder to shoulder”")) throw new Error("the credit travels with the copy");
    await page.screenshot({ path: "screenshots/s03-reframes.png", fullPage: true });
    console.log("✓ reframes: spoken lines by objection, principles apart with no copy-to-prospect, credit on the card and on the clipboard, one copies clean and several under headings");

    // Script wizard: a DM script, library filtered by beat and type, the question and its follow-ups, listen-for, branches
    // on by default at T and Y only, the blanks asked once with the offer prefilled, then a two-sided call sheet and a copy block
    await page.goto(`${base}/socrates/scripts`);
    await fillExact(page, '[data-testid="new-script"] input[name="name"]', "Walk DM script");
    await page.selectOption('[data-testid="new-script"] select[name="scriptType"]', "DM");
    await submit(page, '[data-testid="new-script"] button:has-text("Start")');
    await page.waitForURL(/\/socrates\/scripts\/[a-z0-9-]+/i);
    await expectText(page, "0 of 7", "fresh script");
    const scriptId = page.url().split("/socrates/scripts/")[1].split("?")[0];
    const picks = await page.locator('[data-testid="beat-library"] [data-testid="pick"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    if (picks.join(",") !== "socrates-q22") throw new Error(`Context × DM should offer only q22, got ${picks.join(",")}`);
    if (await page.locator('[data-testid="beat-reframes"]').count()) throw new Error("reframes belong to Objection scripts only");
    if (await page.locator('[data-testid="beat-follow-ups"]').count()) throw new Error("one question in the library offers no follow-up");
    if ((await page.locator('[data-testid="beat-branches"]').getAttribute("data-default")) !== "off" || (await page.locator('[data-testid="branch"]:checked').count()) !== 0) throw new Error("branches are available but off at Context");
    await page.check('[data-testid="pick"][value="socrates-q22"]');
    await fillExact(page, '[data-testid="listen-for"]', "Whether they name the piece or stay vague.");
    await submit(page, 'button:has-text("Save and next")');
    await page.waitForURL(/beat=L/);
    await expectText(page, "1 of 7", "one beat done");
    for (const beat of ["L", "A", "R", "I", "T", "Y"]) {
      await page.goto(`${base}/socrates/scripts/${scriptId}?beat=${beat}`);
      if (beat === "I" && !(await page.locator('[data-testid="beat-empty"]').count())) throw new Error("Implications × DM has no library questions; the empty state must say so");
      if (beat === "A") {
        // Four in the library: the question, then follow-ups capped at two by the server (the first two in library order), and
        // the question itself never doubles as its own follow-up.
        if (!(await page.locator('[data-testid="beat-follow-ups"]').count())) throw new Error("Areas × DM offers follow-ups");
        await page.check('[data-testid="pick"][value="socrates-q18"]');
        await page.check('[data-testid="pick-follow"][value="socrates-q34"]');
        await page.check('[data-testid="pick-follow"][value="socrates-q36"]');
        await page.check('[data-testid="pick-follow"][value="socrates-q32"]');
        await page.check('[data-testid="pick-follow"][value="socrates-q18"]');
      }
      if (beat === "T") {
        const own = await page.locator('[data-testid="beat-library"] [data-testid="pick"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        if (own.length !== 2 || own[0] !== "socrates-q13") throw new Error(`Tailor × DM should offer q13 and the client's own question, got ${own.join(",")}`);
        await page.check('[data-testid="pick"][value="socrates-q13"]');
        await page.check(`[data-testid="pick-follow"][value="${own[1]}"]`);
        if ((await page.locator('[data-testid="beat-branches"]').getAttribute("data-default")) !== "on" || (await page.locator('[data-testid="branch"]:checked').count()) !== 3) throw new Error("branches are on at Tailor with one reframe per objection group prefilled");
        if (await page.locator('[data-testid="branch"][value="r11"]').count()) throw new Error("a principle is never offered as a branch");
        await page.uncheck('[data-testid="branch"][value="r04"]');
      }
      // A stray bracket typed into the client's own words never reaches an output as a bracket (a closed pair is a blank, asked at the fill step).
      await fillExact(page, '[data-testid="override"]', beat === "R" ? "Walk override for beat R. [aside" : `Walk override for beat ${beat}.`);
      if (beat === "Y") await submit(page, '[data-testid="beat-form"] button:has-text("Save and fill in the blanks")');
      else await submit(page, '[data-testid="beat-form"] button:has-text("Save")');
    }
    await page.waitForURL(/beat=fill/);
    await expectText(page, "7 of 7", "complete");
    const saved = await db.query.socratesScripts.findFirst({ where: eq(schema.socratesScripts.id, scriptId) });
    if (saved?.beats.A?.questionIds.join(",") !== "socrates-q18,socrates-q32,socrates-q34") throw new Error(`the question first, two follow-ups, the rest dropped: ${saved?.beats.A?.questionIds.join(",")}`);
    if (saved?.beats.T?.branchIds?.join(",") !== "r01,r07") throw new Error(`the branches the client left on at T: ${saved?.beats.T?.branchIds?.join(",")}`);
    // The blanks, once each, in the order they are met; [3 pillars] prefilled from the live offer
    const keys = await page.locator('[data-testid="fill"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
    if (keys.join("|") !== "topic|pain area|current state|their pain phrase|3 pillars|the bridge") throw new Error(`blanks asked once, in order: ${keys.join("|")}`);
    if ((await page.inputValue('[data-testid="fill"][data-key="3 pillars"]')) !== "Reset, Rhythm, Results") throw new Error("[3 pillars] is the client's own offer, prefilled");
    await expectText(page, "In their words, not yours", "the help line on their pain phrase");
    await expectText(page, "Prefilled from your offer: 90-Day Reset", "the offer named");
    await page.fill('[data-testid="fill"][data-key="topic"]', "meal prep on Sundays");
    await page.fill('[data-testid="fill"][data-key="pain area"]', "the evenings");
    await page.fill('[data-testid="fill"][data-key="current state"]', "the 5pm scramble");
    await page.fill('[data-testid="fill"][data-key="the bridge"]', "one Sunday hour");
    await submit(page, '[data-testid="fill-form"] button:has-text("Save")');
    await page.goto(`${base}/socrates/scripts/${scriptId}`);
    await expectText(page, "still unfilled", "an empty blank is named at the outputs");
    if (!(await page.locator('[data-testid="outputs-unfilled"]').innerText()).includes("their pain phrase")) throw new Error("the unfilled blank is named");
    // Output one: the call sheet, no letters, YOU largest, listen-for italic, branches under their conditions, blanks filled or marked
    await page.click('[data-testid="open-sheet"]');
    await page.waitForURL(/\/sheet$/);
    if (await page.locator("aside, header nav").count()) throw new Error("the sheet has no chrome around it");
    const sheetText = await page.locator('[data-testid="call-sheet"]').innerText();
    if (/[[\]]/.test(sheetText)) throw new Error("the sheet carries no square brackets");
    if (/\bC — Context\b/.test(sheetText)) throw new Error("the framework letters stay in the builder");
    if (!sheetText.includes("Saw your post about meal prep on Sundays")) throw new Error("the filled blank reads as text");
    if (!sheetText.includes("Walk override for beat R. (aside")) throw new Error("a typed bracket becomes a parenthesis on the sheet");
    if ((await page.locator('[data-testid="sheet-unfilled"]').count()) !== 1 || !(await page.locator('[data-testid="sheet-unfilled"]').innerText()).includes("their pain phrase")) throw new Error("the empty blank is shown unfilled, once, where it sits");
    if (!(await page.locator('[data-testid="sheet-beat"][data-n="1"] .italic').innerText()).includes("Whether they name the piece")) throw new Error("listen-for is on the sheet, italic");
    if ((await page.locator('[data-testid="sheet-beat"][data-n="1"] [data-testid="sheet-branch"]').count()) !== 0) throw new Error("no branch at Context");
    if ((await page.locator('[data-testid="sheet-beat"][data-n="6"] [data-testid="sheet-branch"]').count()) !== 2 || (await page.locator('[data-testid="sheet-beat"][data-n="7"] [data-testid="sheet-branch"]').count()) !== 3) throw new Error("branches: the two left on at Tailor, the three defaults at Your Next Step");
    if (!(await page.locator('[data-testid="sheet-branch-condition"]').first().innerText()).includes("If they go to the number")) throw new Error("a branch sits under its condition");
    if (!(await page.locator('[data-testid="sheet-branch-line"]').first().innerText()).startsWith("“Can I show you the way I'd look at that?")) throw new Error("a branch line is the spoken reframe, in quotes");
    if (/\bTHEM\b/.test(sheetText)) throw new Error("the prospect's lines are never written");
    // A click before React has hydrated the button copies nothing: click until the clipboard changes.
    const copyUntil = async (selector: string, ok: (text: string) => boolean) => {
      await page.waitForLoadState("networkidle");
      for (let i = 0; i < 20; i++) {
        await page.click(selector);
        await page.waitForTimeout(250);
        const text = await page.evaluate(() => navigator.clipboard.readText());
        if (ok(text)) return text;
      }
      return page.evaluate(() => navigator.clipboard.readText());
    };
    const sheetClip = await copyUntil('button:has-text("Copy the call sheet")', (t) => t.startsWith("DM — "));
    if (!sheetClip.startsWith("DM — Walk DM script\nBuilt from CLARITY\n")) throw new Error(`the call sheet copies as the sheet: ${sheetClip.slice(0, 60)}`);
    const sheetHtml = await page.evaluate(async () => {
      for (const item of await navigator.clipboard.read()) if (item.types.includes("text/html")) return (await item.getType("text/html")).text();
      return null;
    });
    if (!sheetHtml || !sheetHtml.includes("<em>") || /<br\s*\/?>/i.test(sheetHtml)) throw new Error(`the clipboard carries an HTML flavour built from blocks, never a <br>: ${sheetHtml?.slice(0, 80)}`);
    await page.screenshot({ path: "screenshots/s04-call-sheet.png", fullPage: true });
    // Output two: the copy block, questions only
    await page.goto(`${base}/socrates/scripts/${scriptId}`);
    const block = await copyUntil('button:has-text("Copy the questions")', (t) => t.startsWith("Saw your post"));
    if (block.split("\n").some((l) => !l.trim()) || /YOU|↳|Leaky Pipe|Built from|CONTEXT/.test(block) || !block.startsWith("Saw your post about meal prep on Sundays")) throw new Error(`the copy block is the questions only: ${JSON.stringify(block.slice(0, 120))}`);
    // Filling the last blank clears the warning on the outputs and the mark on the sheet
    await page.goto(`${base}/socrates/scripts/${scriptId}?beat=fill`);
    await page.fill('[data-testid="fill"][data-key="their pain phrase"]', "never having a plan by Thursday");
    await submit(page, '[data-testid="fill-form"] button:has-text("Save")');
    await page.goto(`${base}/socrates/scripts/${scriptId}/sheet`);
    if (await page.locator('[data-testid="sheet-unfilled"]').count()) throw new Error("every blank filled, nothing marked");
    await page.screenshot({ path: "screenshots/s04-script.png", fullPage: true });
    console.log("✓ script wizard: the question and its follow-ups, listen-for, branches on at T and Y only and never a principle, blanks asked once with the offer prefilled, the call sheet in both clipboard flavours without a <br>, the copy block bare");

    // An Objection script pulls a reframe directly, by group
    await page.goto(`${base}/socrates/scripts`);
    await fillExact(page, '[data-testid="new-script"] input[name="name"]', "Walk objection script");
    await page.selectOption('[data-testid="new-script"] select[name="scriptType"]', "Objection");
    await submit(page, '[data-testid="new-script"] button:has-text("Start")');
    await page.waitForURL(/\/socrates\/scripts\/[a-z0-9-]+/i);
    if (await page.locator('[data-testid="beat-reframes"]').count()) throw new Error("reframes are deployed at T, not offered at C");
    const objectionId = page.url().split("/socrates/scripts/")[1].split("?")[0];
    await page.goto(`${base}/socrates/scripts/${objectionId}?beat=T`);
    if (!(await page.locator('[data-testid="beat-reframes"]').count())) throw new Error("an Objection script must offer the grouped reframes at T");
    await expectText(page, "full library", "the whole reframe library stays reachable");
    await page.check('input[name="reframeIds"][value="r04"]');
    await submit(page, '[data-testid="beat-form"] button:has-text("Save")');
    await expectText(page, "1 of 7", "reframe counts as a pick");
    if ((await page.locator('[data-testid="beat-link"][data-beat="T"]').getAttribute("data-done")) !== "1") throw new Error("T should be done after a reframe pick");
    await page.goto(`${base}/socrates/scripts`);
    await expectText(page, "Walk objection script", "list");
    console.log("✓ objection script pulls a reframe by group, at T");

    // Conversations points at the method
    await page.goto(`${base}/conversations`);
    await expectText(page, "CLARITY in short form", "conversations link");
    await page.click('[data-testid="clarity-link"] a');
    await page.waitForURL(/\/socrates\/foundations/);
    console.log("✓ conversations links to Socrates Domain");
  } finally {
    await browser.close();
  }
  if (failures.length) throw new Error(`Errors:\n${failures.join("\n")}`);
  console.log("Socrates smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
