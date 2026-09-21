/** Smoke walk for the wizards, clients, community pass, and repurposing. Run with the dev server up. */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

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
  await page.waitForTimeout(500);
}
/** Fill after the page has hydrated: a fill that lands mid-hydration can insert at the caret instead of replacing, so the value is checked. */
async function fillField(page: Page, selector: string, value: string) {
  await page.waitForLoadState("networkidle");
  await page.fill(selector, value);
  if ((await page.inputValue(selector)) !== value) await page.fill(selector, value);
  if ((await page.inputValue(selector)) !== value) throw new Error(`${selector} did not take the value typed into it`);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  console.log(`✓ ${name}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  // The brand kit the deck renders in, saved by the coach first: the Turas kit with its placeholder colour and one permitted name
  const coach = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await coach.goto(`${base}/login`);
  await coach.click('button:has-text("As the coach")');
  await coach.waitForURL(/\/today/);
  await coach.goto(`${base}/settings`);
  await coach.locator('[data-testid="brand-form"]').waitFor({ timeout: 15000 });
  const kit: Record<string, string> = { name: "Turas — True North", ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5", displayFont: "Red Hat Display", bodyFont: "Helvetica Now Display", quoteFont: "Libre Baskerville", fontFallback: "Arial", bannedColors: "000000", placeholder: "FFF3A3", aliases: "Turas" };
  for (const [k, v] of Object.entries(kit)) await coach.fill(`[data-testid="brand-form"] input[name="${k}"]`, v);
  await submit(coach, '[data-testid="brand-form"] button[type="submit"]');
  await coach.locator('[data-testid="brand-saved"]').waitFor({ timeout: 10000 });
  if ((await coach.locator('[data-testid="brand-aliases"]').inputValue()) !== "Turas") throw new Error("the permitted name is read back");
  await coach.context().close();
  console.log("✓ the coach saved the Turas kit with its placeholder colour and one permitted name");

  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);

  // Webinars
  await page.goto(`${base}/webinars`);
  await expectText(page, "Leaky Webinar", "webinars list");
  // The labels are read off the record: the delivered example is a worked example, the seeded half-built one says so
  if (!(await page.locator(".card", { hasText: "Leaky Webinar" }).getByText("worked example").count())) throw new Error("the delivered example is labelled a worked example");
  if (!(await page.locator(".card", { hasText: "Eat Like a Grown-Up" }).getByText("example, half built").count())) throw new Error("a seeded example with sections still to script says so");
  await shot(page, "w01-webinars");
  // Start from the example copies the shape and never the words: twenty sections, named and in order, every one empty
  const { db: dbw, schema: sw } = await import("@/db");
  const { eq: eqw, asc: ascw } = await import("drizzle-orm");
  await submit(page, 'button:has-text("Start from the example")');
  await page.waitForURL(/\/webinars\/[^/?]+\?step=foundation/);
  const newId = page.url().split("/webinars/")[1].split("?")[0];
  const copied = await dbw.query.webinarSections.findMany({ where: eqw(sw.webinarSections.webinarId, newId), orderBy: ascw(sw.webinarSections.order) });
  if (copied.length !== 20 || copied[0].name !== "Hook" || copied[19].order !== 20) throw new Error(`the shape is copied: twenty named sections in order, got ${copied.length}`);
  if (copied.some((s) => s.script || s.keyPoints || s.status !== "todo")) throw new Error("no word of the example is copied: every section is empty and to do");
  const fresh = (await dbw.query.webinars.findFirst({ where: eqw(sw.webinars.id, newId) }))!;
  if (fresh.promise || fresh.audience || fresh.mechanismName || fresh.isExample) throw new Error("the Foundation arrives empty and the copy is the coach's own, not an example");
  console.log("✓ Start from the example: the shape, never the words");
  await page.goto(`${base}/webinars`);
  await page.click('a:has-text("Eat Like a Grown-Up")');
  await page.waitForURL(/\/webinars\//);
  await expectText(page, "Foundation", "wizard");
  // The presenter is a field: the title slide, the file's author and the script's "I" read it; empty means the subject's own name
  await page.goto(page.url().split("?")[0] + "?step=foundation");
  await page.fill('[data-testid="presenter"]', "Lindsey Brittain");
  // The opening the record can fill: the stay line and two of the eight beats; each filled one is a slide, each empty one is not
  await fillField(page, '[data-testid="stay-line"]', "Stay to the end for the one swap that matters.");
  await fillField(page, '[data-testid="beat-wanted"]', "I wanted a practice that ran without me.");
  await fillField(page, '[data-testid="beat-wall"]', "The week I rebuilt everything at 2am.");
  await submit(page, 'button:has-text("Save and map beliefs")');
  await page.goto(page.url().split("?")[0] + "?step=script");
  await page.waitForURL(/[?&]section=/);
  await expectText(page, "Leaky Webinar version", "script step");
  if (!/[?&]section=/.test(page.url())) throw new Error(`the address names the section being edited, got ${page.url()}`);
  const wizardBase = page.url().split("?")[0];
  await page.goto(`${wizardBase}?step=readiness`);
  await page.waitForURL((u) => /[?&]step=(foundation|beliefs|script|offer|deck|review|run)\b/.test(u.search) && !/step=readiness/.test(u.search));
  console.log(`✓ an unknown step is sent to a real one, visibly: ${page.url().split("?")[1]}`);
  await page.goto(`${wizardBase}?step=script`);
  await page.waitForURL(/[?&]section=/);
  // "Start from the example" writes nothing: the example is shown beside the field and the field stays empty
  const exampleKey = await page.locator('form input[name="sectionKey"]').first().inputValue();
  const scriptBefore = await page.locator('textarea[name="script"]').inputValue();
  await submit(page, 'button:has-text("Start from the example")');
  await page.locator('[data-testid="example-not-written"]').waitFor({ timeout: 10000 });
  if ((await page.locator('textarea[name="script"]').inputValue()) !== scriptBefore) throw new Error("the example must never become the section's words");
  if (!page.url().includes(`section=${exampleKey}`)) throw new Error("the example opens on the same section");
  if (!(await page.locator('[data-testid="section-example"][open]').count())) throw new Error("the example is shown beside the field");
  console.log("✓ the example is shown beside the field and never written into it");
  await shot(page, "w02-webinar-script");
  // A script that introduces someone else is caught on the section and in the build check, by name
  const firstKey = await page.locator('form input[name="sectionKey"]').first().inputValue();
  await fillField(page, 'textarea[name="script"]', "I'm Danno Hanfling, and I've spent years at this. If you've ever lost 10 pounds and gained it back, this is for you.");
  await submit(page, 'button:has-text("Save and next")');
  await page.goto(page.url().split("?")[0] + `?step=script&section=${firstKey}`);
  const mismatch = await page.locator('[data-testid="name-mismatch"]').innerText();
  if (!mismatch.includes("Danno Hanfling") || !mismatch.includes("Lindsey Brittain")) throw new Error(`the script step names the wrong name and the presenter, got "${mismatch}"`);
  // A permitted name from the kit opens a script with no warning and is never reported as the presenter
  await fillField(page, 'textarea[name="script"]', "Turas here. I'm Turas, and this is for you.");
  await submit(page, 'button:has-text("Save and next")');
  await page.goto(page.url().split("?")[0] + `?step=script&section=${firstKey}`);
  if (await page.locator('[data-testid="name-mismatch"]').count()) throw new Error(`a permitted name is not a second presenter, got "${await page.locator('[data-testid="name-mismatch"]').innerText()}"`);
  await fillField(page, 'textarea[name="script"]', "Hi everyone. If you've ever lost 10 pounds and gained it back, this is for you. Here's the plan for the next hour.");
  await submit(page, 'button:has-text("Save and next")');
  await expectText(page, "drafted", "section saved");
  // Cleared means cleared: the section shows no mismatch and holds exactly the presenter's own script
  await page.goto(page.url().split("?")[0] + `?step=script&section=${firstKey}`);
  if (await page.locator('[data-testid="name-mismatch"]').count()) throw new Error(`the presenter's own script clears the guard, got "${await page.locator('[data-testid="name-mismatch"]').innerText()}"`);
  if (!(await page.locator('textarea[name="script"]').inputValue()).startsWith("Hi everyone.") || /Danno|Turas/.test(await page.locator('textarea[name="script"]').inputValue())) throw new Error("the section holds the script the walk wrote, and nothing from an earlier fill");
  console.log("✓ presenter saved; a script introducing someone else is named on the section, and cleared; a permitted name passes");
  await page.goto(page.url().split("?")[0] + "?step=beliefs");
  await shot(page, "w03-webinar-beliefs");
  // Belief breaks: a confirmed study can be picked, the search opens with the belief's text as the claim, and a typed proof
  // is gated by the same permission tick as the bank; ticked and saved to the bank, it lands there as a draft
  const beliefsUrl = page.url();
  if ((await page.locator('[data-testid="belief-evidence-vehicle"] option').count()) < 2) throw new Error("the belief step must offer the shared starter shelf's studies");
  const findHref = await page.locator('[data-testid="find-research-vehicle"]').getAttribute("href");
  if (!findHref?.startsWith("/evidence?claim=")) throw new Error(`find research must open the search with the claim pre-filled, got ${findHref}`);
  await fillField(page, '[data-testid="belief-freetext-vehicle"]', "Priya N. went from 2 to 9 discovery calls a week in her first month.");
  await submit(page, 'button:has-text("Save beliefs"), button:has-text("Save and next"), form:has([data-testid="belief-freetext-vehicle"]) button[type="submit"]');
  await page.goto(beliefsUrl);
  if (!(await page.locator('[data-testid="belief-needs-tick-vehicle"]').count())) throw new Error("a typed proof without the tick must be marked unusable");
  await page.fill('[data-testid="belief-who-vehicle"]', "Priya N.");
  // Pick a study from the shared shelf for Act 1: the run sheet renders it on that act later
  await page.selectOption('[data-testid="belief-evidence-vehicle"]', { index: 1 });
  await page.check('[data-testid="belief-permission-vehicle"] input');
  await page.check('form:has([data-testid="belief-freetext-vehicle"]) input[name="vehicle_toBank"]');
  await submit(page, 'form:has([data-testid="belief-freetext-vehicle"]) button[type="submit"]');
  await expectText(page, "Saved to your Proof Bank as a draft", "bank contribution");
  await page.goto(beliefsUrl);
  if (await page.locator('[data-testid="belief-needs-tick-vehicle"]').count()) throw new Error("with the tick recorded the typed proof is usable");
  await expectText(page, "Priya N. has given me permission", "tick wording carries the name");
  await page.goto(`${base}/proof`);
  await expectText(page, "Priya N.", "the contribution is in the bank");
  console.log("✓ belief breaks: evidence offered, search pre-filled, typed proof gated by tick two and routed to the bank as a draft");
  await page.goto(beliefsUrl);
  // The deck: what refuses at the route refuses on the step, before the click. The seed exports clean; the walk plants both
  // clauses' refusals itself, on the Opportunity Frame (a) and the Proof Block (b).
  const wizardUrl0 = page.url().split("?")[0];
  const saveSection = async (key: string, fields: { keyPoints?: string; status?: "drafted" | "final" | "omitted"; reveal?: boolean }) => {
    await page.goto(`${wizardUrl0}?step=script&section=${key}`);
    if (fields.keyPoints !== undefined) await fillField(page, 'textarea[name="keyPoints"]', fields.keyPoints);
    if (fields.status) await page.check(`input[name="status"][value="${fields.status}"]`);
    if (fields.reveal) await page.check('[data-testid="build-reveal"]');
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator('button[type="submit"]', { hasText: /^Save$/ }).first().click()]);
    await page.waitForLoadState("networkidle");
  };
  await page.goto(`${wizardUrl0}?step=deck`);
  if (await page.locator('[data-testid="deck-refused"]').count()) throw new Error(`the demo webinar exports clean as seeded, got "${await page.locator('[data-testid="deck-refused"]').innerText()}"`);
  // Clean because the seed dropped the one line with a hole, not every line: the Hook's three example points are on three slides
  if ((await page.locator('[data-testid="deck-slide"][data-section="hook"]').count()) !== 3) throw new Error(`the seeded Hook keeps its three key points, got ${await page.locator('[data-testid="deck-slide"][data-section="hook"]').count()} slides`);
  // Clause (a), planted: a numeric placeholder in a sentence carrying a percentage
  await saveSection("opportunity_frame", { keyPoints: "[X]% of conversions are former no's\nThe no is data" });
  await page.goto(`${wizardUrl0}?step=deck`);
  await page.locator('[data-testid="deck-refused"]').waitFor({ timeout: 15000 });
  if (await page.locator('[data-testid="deck-pptx"]').count()) throw new Error("a refused deck has no download button");
  let refusedText = await page.locator('[data-testid="deck-refused"]').innerText();
  if (!/\(Opportunity Frame\): \[X\]% sits in a sentence that carries a number/.test(refusedText)) throw new Error(`a numeric placeholder is refused before the click, with the slide named, got "${refusedText}"`);
  const deckHref = `/api/webinars/${wizardUrl0.split("/webinars/")[1]}/deck?format=pptx`;
  const refusedRes = await page.request.get(`${base}${deckHref}`);
  if (refusedRes.status() !== 409 || !((await refusedRes.json()).refused ?? []).length) throw new Error(`the route refuses the same deck with the reasons, got ${refusedRes.status()}`);
  // Clause (b): a placeholder on a Proof Block refuses whatever the sentence around it says
  await saveSection("proof_block", { keyPoints: "[CLIENT NAME] doubled her list" });
  await page.goto(`${wizardUrl0}?step=deck`);
  refusedText = await page.locator('[data-testid="deck-refused"]').innerText();
  if (!/\(Proof Block\): \[CLIENT NAME\] sits on a proof slide, which is a claim by its nature/.test(refusedText)) throw new Error(`a Proof Block placeholder is refused with no digit in the sentence, got "${refusedText}"`);
  console.log("✓ deck: a numeric placeholder and a Proof Block placeholder each refuse the export before the click, with the slide named; the route says the same");
  // Fill the claims, leave one gap that only warns, and leave a section out on purpose
  await saveSection("opportunity_frame", { keyPoints: "Former no's are the biggest pool you have\nSend them to [SALES PAGE URL]" });
  await saveSection("proof_block", { keyPoints: "Results across clients" });
  await saveSection("credibility_origin", { status: "omitted" });
  await saveSection("hook", { reveal: true });
  await page.goto(`${wizardUrl0}?step=deck`);
  // The beats belong to the omitted section and go with it; the stay line stands after the Hook; the Hook builds up, three slides still
  if (await page.getByText("I wanted a practice that ran without me.").count()) throw new Error("the beats of a section left out are left out with it");
  if (!(await page.locator('[data-testid="deck-slide"]', { hasText: "Stay to the end for the one swap that matters." }).count())) throw new Error("the stay line is its own slide");
  const hookCards = page.locator('[data-testid="deck-slide"][data-section="hook"]');
  const hookCount = await hookCards.count();
  const heads: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < hookCount; i++) {
    heads.push(await hookCards.nth(i).locator('[data-testid="deck-headline"]').innerText());
    bodies.push((await hookCards.nth(i).locator('[data-testid="deck-body"]').count()) ? await hookCards.nth(i).locator('[data-testid="deck-body"]').innerText() : "");
  }
  // One slide per point under the same line: the first card bare, the second with one body line, the third carrying that line and one more
  if (hookCount !== 3 || new Set(heads).size !== 1 || bodies[0] !== "" || !bodies[1] || !bodies[2].includes(bodies[1]) || bodies[2] === bodies[1]) throw new Error(`a reveal keeps one slide per point and builds the body up under the same line, got ${JSON.stringify({ heads, bodies })}`);
  await expectText(page, "A structured text deck, styled in your own template", "the deck step says what the file is");
  if (await page.locator('[data-testid="deck-refused"]').count()) throw new Error(`the filled deck is no longer refused, got "${await page.locator('[data-testid="deck-refused"]').innerText()}"`);
  if (!/\[SALES PAGE URL\] is a gap to fill/.test(await page.locator('[data-testid="deck-warnings"]').innerText())) throw new Error("a placeholder outside a claim warns rather than refuses");
  if (!/^1 unfilled \[placeholder\]/.test(await page.locator('[data-testid="deck-placeholders"]').innerText())) throw new Error("the count of unfilled slots is shown");
  if (await page.locator('[data-testid="deck-slide"][data-section="credibility_origin"]').count()) throw new Error("a section left out on purpose has no slide");
  if (!(await page.locator('[data-testid="deck-slide"][data-kind="proof"]').count())) throw new Error("the Proof Block renders the typed proof as a slide");
  // The count against a rate: slides a minute over the minutes without Q&A, the arithmetic checked rather than the number assumed
  const paceText = await page.locator('[data-testid="deck-pace"]').innerText();
  const paceMatch = paceText.match(/^(\d+) slides · ~(\d+) min without Q&A · ([\d.]+) slides a minute\. Reference pace is 1\.7, measured from a live 90-minute deck with Q&A not counted; the band is 1\.2 to 1\.5\./);
  if (!paceMatch) throw new Error(`the deck step reads slides against the clock, got "${paceText}"`);
  const [, slideCount, minutes, rate] = paceMatch;
  if (Math.round((Number(slideCount) / Number(minutes)) * 10) / 10 !== Number(rate)) throw new Error(`the rate is the count over the minutes, got ${slideCount}/${minutes} = ${rate}`);
  if ((await page.locator('[data-testid="deck-slide"]').count()) !== Number(slideCount)) throw new Error("the readout counts the slides shown");
  if ((await page.locator('[data-testid="deck-slide"][data-kind="divider"]').count()) !== 3 || !(await page.locator('[data-testid="deck-slide"][data-kind="recap"]').count())) throw new Error("a divider per belief act and a recap for the act that has lines");
  console.log(`  deck density: ${paceText}`);
  const pptx = await page.request.get(`${base}${deckHref}`);
  const pptxBody = await pptx.body();
  if (!pptx.ok() || !(pptx.headers()["content-type"] ?? "").includes("presentationml") || pptxBody.subarray(0, 2).toString() !== "PK" || pptxBody.length < 5000) throw new Error(`pptx export failed: ${pptx.status()} ${pptxBody.length} bytes`);
  const txt = await page.request.get(`${base}${deckHref.replace("pptx", "txt")}`);
  const txtText = await txt.text();
  if (!txt.ok() || !/Deck outline · \d+ slides · 1 unfilled on slides/.test(txtText)) throw new Error("txt export failed");
  if (/Credibility/.test(txtText) || /Visual/.test(txtText) || !/discovery calls/.test(txtText)) throw new Error("the outline carries the proof, not the omitted section, and no art direction");
  // The file says whose it is: the presenter as author, the workspace as company, the webinar as subject, never the generator
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(pptxBody);
  const core = await zip.file("docProps/core.xml")!.async("string");
  const app = await zip.file("docProps/app.xml")!.async("string");
  const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  if (!/<dc:creator>Lindsey Brittain<\/dc:creator>/.test(core)) throw new Error(`dc:creator is the presenter, got ${core.match(/<dc:creator>[^<]*/)?.[0]}`);
  if (/PptxGenJS/.test(core) || /<Company>PptxGenJS/.test(app)) throw new Error("the generator's name is nowhere in the file's properties");
  if (!/<dc:subject>[^<]+<\/dc:subject>/.test(core) || /<dc:subject>PptxGenJS/.test(core)) throw new Error("dc:subject is the webinar's title");
  if (!/Lindsey Brittain/.test(slide1)) throw new Error("the title slide carries the presenter");
  // The kit on the file: its hex verbatim and its faces named; the proof slide's text from the record; no art direction on any face
  const faces = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")))).join("\n");
  const notes = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")))).join("\n");
  for (const hex of ["FAF8F5", "6E6256", "DD2727", "FFF3A3"]) if (!faces.includes(hex)) throw new Error(`the kit's ${hex} is written verbatim on the slides`);
  for (const face of ["Red Hat Display", "Helvetica Now Display", "Libre Baskerville"]) if (!faces.includes(face)) throw new Error(`the kit's face ${face} is named on the slides`);
  if (/Visual/.test(faces)) throw new Error("no art direction on any face");
  if (!/Visual direction/.test(notes)) throw new Error("the art direction is in the speaker notes");
  if (!/discovery calls/.test(faces) || !/Priya N\./.test(faces)) throw new Error("the proof slide's text is the typed proof with its tick, as the record stores it");
  if (/Credibility/.test(faces)) throw new Error("the omitted section is absent from the file");
  console.log(`  deck export: pptx ${pptxBody.length} bytes in the Turas kit, txt ok; author, company and subject are the presenter's, the workspace's and the webinar's`);
  // The price anchor is the control: on by default, the stack's total and the saving are on the slides. A house policy turns it off on the kit,
  // and the next export draws the price on its own with the running totals, the payment plan and the guarantee still there.
  if (!/Total value: USD \$4,994/.test(faces) || !/You save USD \$3,494/.test(faces)) throw new Error("the anchor slide carries the total and the saving by default");
  const coach2 = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await coach2.goto(`${base}/login`);
  await coach2.click('button:has-text("As the coach")');
  await coach2.waitForURL(/\/today/);
  await coach2.goto(`${base}/settings`);
  await coach2.locator('[data-testid="brand-form"]').waitFor({ timeout: 15000 });
  if (!(await coach2.locator('[data-testid="brand-price-anchor"]').isChecked())) throw new Error("the price anchor is on by default");
  await coach2.uncheck('[data-testid="brand-price-anchor"]');
  await submit(coach2, '[data-testid="brand-form"] button[type="submit"]');
  await coach2.locator('[data-testid="brand-saved"]').waitFor({ timeout: 10000 });
  if (await coach2.locator('[data-testid="brand-price-anchor"]').isChecked()) throw new Error("the kit reads the anchor back as off");
  await coach2.context().close();
  const offRes = await page.request.get(`${base}${deckHref}`);
  if (!offRes.ok()) throw new Error(`export with the anchor off failed: ${offRes.status()}`);
  const zipOff = await JSZip.loadAsync(await offRes.body());
  const facesOff = (await Promise.all(Object.keys(zipOff.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).map((f) => zipOff.file(f)!.async("string")))).join("\n");
  if (/Total value:|You save/.test(facesOff)) throw new Error("with the anchor off no slide compares the price to the total");
  // The guarantee slide is the offer's own guarantee line as seeded, with its apostrophe escaped in the XML
  if (!/USD \$1,500/.test(facesOff) || !/Total value so far/.test(facesOff) || !/I coach you free until you do/.test(facesOff) || !/Payment plan: 3 x \$550/.test(facesOff)) throw new Error("the price, the running totals, the payment plan and the guarantee still render with the anchor off");
  console.log("✓ price anchor: on by default with the total and the saving; off on the kit, the next export draws the price on its own");
  await shot(page, "w04-webinar-deck");
  await page.goto(page.url().split("?")[0] + "?step=review");
  // The header is the build check, itemised, and no rating moves it: eleven fives leave an unscripted webinar "building"
  const summary = await page.locator('[data-testid="build-summary"]').innerText();
  if (!/\d+\/\d+ scripted · ~\d+ min · \d+ of \d+ checks/.test(summary)) throw new Error(`the header reads the build check, got "${summary}"`);
  if (/% built/.test(summary)) throw new Error("the build percentage is gone");
  const openBefore = await page.locator('[data-testid="build-check"] li[data-ok="0"]').count();
  if (!openBefore) throw new Error("the demo webinar has open checks to test against");
  for (const k of ["promise", "audience", "vehicle", "internal", "external", "cta", "objections", "convert"]) await page.click(`label:has(input[name="r_${k}"][value="5"])`);
  // Proof, stories and offer are graded by the record, with the working shown; they can be lowered with a reason, never raised
  for (const k of ["proof", "stories", "offer"]) {
    if (await page.locator(`label:has(input[name="r_${k}"])`).count()) throw new Error(`${k} is no longer a slider`);
    if (!/Read off the record: .* Grade [1-5]/.test(await page.locator(`[data-testid="derived-${k}"]`).innerText())) throw new Error(`${k} shows its working and its grade`);
  }
  await submit(page, 'button:has-text("Save review")');
  await expectText(page, "Verdict", "review saved");
  const decision = await page.locator('[data-testid="ready-decision"]').innerText();
  if (!decision.startsWith("Not ready yet.") || !/checks? open:/.test(decision)) throw new Error(`eleven fives do not make it ready; the decision names the open checks, got "${decision}"`);
  if ((await page.locator('[data-testid="build-check"] li[data-ok="0"]').count()) !== openBefore) throw new Error("the rating moved a build check");
  if (!page.url().includes("step=review")) throw new Error("an unready webinar stays on the review step rather than advancing to Run it");
  // The delivery note and the run sheet: the sheet is the whole webinar in running order with the clock, everything wired rendered in place
  await page.goto(page.url().split("?")[0] + "?step=script");
  await page.waitForURL(/[?&]section=/);
  await fillField(page, '[data-testid="delivery-note"]', "Wait for the chat to fill before you go on.");
  await submit(page, 'button:has-text("Save and next")');
  const wizardUrl = page.url().split("?")[0];
  await page.goto(`${wizardUrl}/runsheet`);
  await page.locator('[data-testid="run-sheet"]').waitFor({ timeout: 20000 });
  if ((await page.locator('[data-testid="runsheet-act"]').count()) !== 5) throw new Error("five acts on the run sheet");
  const clocks = await page.locator('[data-testid="runsheet-clock"]').allInnerTexts();
  // 19 sections on the sheet: the record has 20 and this walk left Credibility / Origin out on purpose above
  if (clocks.length !== 19 || !clocks[0].endsWith("0:00") || !/\d+ min · \d+:\d\d/.test(clocks[5])) throw new Error(`a cumulative clock per section, the omitted one absent, got ${clocks.length}: ${JSON.stringify(clocks.slice(0, 6))}`);
  if (await page.locator('[data-testid="run-sheet"]').getByText("Credibility / Origin").count()) throw new Error("a section left out on purpose is not on the run sheet");
  await expectText(page, "Wait for the chat to fill before you go on.", "the delivery note is on the run sheet");
  if (!(await page.locator('[data-testid="runsheet-proof"]').count())) throw new Error("the typed proof with its tick is rendered on its act");
  const sheetProof = await page.locator('[data-testid="runsheet-proof"]').first().innerText();
  if (!sheetProof.includes("Priya N. went from 2 to 9 discovery calls a week in her first month.") || /47 moms/.test(sheetProof)) throw new Error(`the sheet carries the proof the walk typed and nothing of the seed's, got "${sheetProof}"`);
  // The sheet counts the whole section and says which slots the deck does not show: the drafted scripts' [Drafted] markers are off-slide
  const sheetCount = await page.locator('[data-testid="runsheet-placeholders"]').innerText();
  if (!/^\d+ unfilled, \d+ of them in scripts the deck does not show: /.test(sheetCount) || !/\[Drafted\]/.test(sheetCount)) throw new Error(`the run sheet names off-slide slots as off-slide, got "${sheetCount}"`);
  if (!(await page.locator('[data-testid="runsheet-evidence"]').count())) throw new Error("the picked study is rendered on its act");
  if (!(await page.locator('[data-testid="runsheet-offer"]').count())) throw new Error("the linked offer is rendered on the closing frame");
  await shot(page, "w05b-webinar-runsheet");
  await page.goto(`${wizardUrl}?step=review`);
  console.log("✓ run sheet: five acts, a cumulative clock, the delivery note, the proof, the study and the offer rendered where they are wired");
  // The twelfth check reads the deck: it is on the list, and the "not checked yet" line is gone
  if (await page.locator('[data-testid="deck-unchecked"]').count()) throw new Error("the deck is checked now; the placeholder line retired");
  const deckCheck = await page.locator('[data-testid="build-check"] li[data-check="deck"]').innerText();
  if (!/Deck (exports|moves at a live pace)/.test(deckCheck) || !/slides a minute; the band is 1\.2 to 1\.5/.test(deckCheck)) throw new Error(`the build check reads the deck's pace, got "${deckCheck}"`);
  for (const k of ["proofs", "stories", "citations"]) if (!(await page.locator(`[data-testid="build-check"] li[data-check="${k}"]`).count())) throw new Error(`the build check has a per-act ${k} presence line`);
  const citations = await page.locator('[data-testid="build-check"] li[data-check="citations"]').innerText();
  if (!/Every act has a citation/.test(citations) || !/(Act [123] has no citation|All three acts)/.test(citations)) throw new Error(`the citation check says which act lacks one, got "${citations}"`);
  await shot(page, "w05-webinar-review");
  // Choosing ready on the Run step with checks open is refused where it is chosen; the other fields still save
  await page.goto(page.url().split("?")[0] + "?step=run");
  await page.selectOption('select[name="status"]', "ready");
  await page.fill('input[name="registrationUrl"]', "https://example.com/register");
  await submit(page, 'form:has(select[name="status"]) button[type="submit"]');
  await page.locator('[data-testid="status-held"]').waitFor({ timeout: 15000 });
  const held = await page.locator('[data-testid="status-held"]').innerText();
  if (!held.startsWith("Not set to ready:")) throw new Error(`the run step says why the status was held, got "${held}"`);
  if ((await page.locator('select[name="status"]').inputValue()) === "ready") throw new Error("the status did not change");
  if ((await page.locator('input[name="registrationUrl"]').inputValue()) !== "https://example.com/register") throw new Error("the other fields saved");
  // A review saved before the record's next edit is marked stale
  await page.goto(page.url().split("?")[0] + "?step=script");
  await page.waitForURL(/[?&]section=/);
  await page.fill('textarea[name="script"]', "Hi everyone. If you've ever lost 10 pounds and gained it back, this is for you. Here's the plan for the next hour, and the one swap that matters.");
  await submit(page, 'button:has-text("Save and next")');
  await page.goto(page.url().split("?")[0] + "?step=review");
  if (!(await page.locator('[data-testid="review-stale"]').count())) throw new Error("a review older than the last edit is marked stale");
  console.log("✓ build check itemised in the header; eleven fives never set ready; ready refused on the Run step with the checks named; a stale review says so");

  // Offers
  await page.goto(`${base}/offers`);
  await expectText(page, "90-Day Reset", "offers");
  await page.click('a:has-text("90-Day Reset")');
  await page.waitForURL(/\/offers\//);
  // The price carries its currency; the container is chosen, never assumed
  await page.selectOption('[data-testid="offer-currency"]', "NZD");
  if (!(await page.locator('[data-testid="offer-container"] option[value=""]').count())) throw new Error("the container select offers a blank choice, not a default");
  // Step 6 reads the bank: the older fixed answers still count and can move into it; a ticked bank objection with a reframe counts too
  const answeredBefore = Number((await page.locator('[data-testid="objections-answered"]').innerText()).split(" ")[0]);
  if (!(await page.locator('[data-testid="legacy-objections"]').count())) throw new Error("the example offer's older answers should be shown as still counted");
  await submit(page, '[data-testid="move-objTime"]');
  const answeredAfter = Number((await page.locator('[data-testid="objections-answered"]').innerText()).split(" ")[0]);
  if (answeredAfter !== answeredBefore) throw new Error(`moving an answer into the bank must not change the count (${answeredBefore} → ${answeredAfter})`);
  if (await page.locator('[data-testid="move-objTime"]').count()) throw new Error("a moved answer should leave the older field");
  console.log(`✓ offer step 6 reads the bank; a legacy answer moved in without changing the optimiser's count (${answeredAfter})`);
  // The deck footer is one line on the offer: it lands on every slide from the Offer Stack onward and on none before, and a re-export carries it
  await fillField(page, 'textarea[name="ctaFooter"]', "DM me the word PLAN to book your call");
  await submit(page, 'button:has-text("Save offer")');
  const again = await page.request.get(`${base}${deckHref}`);
  if (!again.ok()) throw new Error(`re-export failed: ${again.status()}`);
  const zip2 = await JSZip.loadAsync(await again.body());
  const slideFiles = Object.keys(zip2.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const xml = await Promise.all(slideFiles.map((f) => zip2.file(f)!.async("string")));
  const withFooter = xml.map((x, i) => (x.includes("DM me the word PLAN") ? i + 1 : 0)).filter(Boolean);
  if (!withFooter.length || withFooter[0] < 3 || withFooter[withFooter.length - 1] !== xml.length) throw new Error(`the footer runs from the offer to the last slide, got slides ${withFooter.join(",")} of ${xml.length}`);
  if (xml[1].includes("DM me the word PLAN")) throw new Error("no footer before the offer");
  console.log(`✓ deck footer on slides ${withFooter[0]}–${xml.length} of ${xml.length} after a re-export`);
  await expectText(page, "Optimizer", "offer wizard");
  await shot(page, "w06-offer-wizard");
  await page.fill('form:has(input[name="offerId"]) input[name="name"]', "Weekend & Wine Playbook v2");
  await submit(page, 'form:has(input[name="offerId"]) button:has-text("Add")');
  await expectText(page, "Weekend & Wine Playbook v2", "component added");

  // Repurpose
  await page.goto(`${base}/content?view=posted`);
  await page.click('a:has-text("Why most diets fail")');
  await page.waitForURL(/\/content\//);
  await page.click('a:has-text("Every version")');
  await page.waitForURL(/\/repurpose/);
  await expectText(page, "Everywhere else", "repurpose");
  await submit(page, 'button:has-text("Generate drafts")');
  await expectText(page, "Threads", "variants");
  await shot(page, "w07-repurpose");

  // Clients
  await page.goto(`${base}/clients`);
  await expectText(page, "Sarah Kim", "clients");
  await shot(page, "w08-clients");
  await page.click('a:has-text("Priya Natarajan")');
  await page.waitForURL(/\/clients\//);
  await page.fill('textarea[name="wins"]', "Slept 7 hours twice this week.");
  await page.fill('input[name="mindset"]', "7");
  await submit(page, 'button:has-text("Save check-in")');
  await expectText(page, "Slept 7 hours", "checkin logged");
  await page.fill('input[name="reason"]', "First check-in done");
  await submit(page, 'button:has-text("Award")');
  await expectText(page, "First check-in done", "points awarded");
  await shot(page, "w09-client-detail");

  // Community pass
  await page.goto(`${base}/community`);
  await expectText(page, "Leaderboard", "community");
  await shot(page, "w10-community");

  // Today shows the new actions
  await page.goto(`${base}/today`);
  await expectText(page, "Next best action", "today");
  await shot(page, "w11-today");

  // Mobile more page
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await m.goto(`${base}/login`);
  await m.click('button:has-text("As a client")');
  await m.waitForURL(/\/today/);
  const moreRes = await m.goto(`${base}/more`);
  if (!moreRes || moreRes.status() !== 200) throw new Error(`/more returned ${moreRes?.status()}`);
  await m.screenshot({ path: "screenshots/w12-mobile-more.png" });
  console.log("✓ w12-mobile-more");

  // Coach toggles pass
  await page.goto(`${base}/settings`);
  await page.click('button:has-text("Log out")');
  await page.waitForURL(/\/login/);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
  await page.goto(`${base}/coach`);
  await expectText(page, "Tier", "coach tier column");
  await browser.close();
  // Never vacuous: every walk asserts page content before this runs, so the responses this reads over are never an empty set.
  if (failures.length) {
    console.error("FAILURES:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Wizard smoke passed.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
