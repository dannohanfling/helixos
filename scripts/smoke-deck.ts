/**
 * Deck v2: the opening contract and the picture slots, read off the rendered Deck step. A fresh webinar is filled with the
 * opening contract, one line left blank; the Deck step must show the filled lines as slides in order, list the blank one as
 * omitted, and count the suggested pictures. Then every example in deck-face.ts is written into the webinar as a key point: the
 * Deck step lists each as kept off, and the exported .pptx is read face by face and fails the build if any face carries a word
 * from those classes, or a currency that is not the offer's (a line in another currency refuses the export until the Offer's
 * currency is set). Every expected string is the coach's own input or read from the record or the module, never typed from
 * memory. Run with the dev server up.
 */
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}
async function fillField(page: Page, selector: string, value: string) {
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 5; i++) {
    await page.fill(selector, value);
    if ((await page.locator(selector).inputValue()) === value) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${selector} did not take the value`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${base}/login`);
    await page.click('button:has-text("As a client")');
    await page.waitForURL(/\/today/);

    // A fresh webinar from the example: twenty empty sections, its own Foundation to fill.
    await page.goto(`${base}/webinars`);
    await submit(page, 'button:has-text("Start from the example")');
    await page.waitForURL(/\/webinars\/[^/?]+\?step=foundation/);
    const wizardBase = page.url().split("?")[0];

    // The coach's own opening contract, one line (permission) left blank on purpose.
    const contract = {
      "promise-line": "Leave with a plan you'll actually run this week.",
      "chat-prompt": "Say hi and drop where you're tuning in from.",
      "ground-rule": "Nothing here is a promise of income.",
      "session-goal": "Get you to your first booked call.",
      "outcome-1": "A clear next step",
      "outcome-2": "A plan for the week",
      "outcome-3": "One belief broken",
      "reflection-prompt": "What is this already costing you?",
    };
    await page.goto(`${wizardBase}?step=foundation`);
    await fillField(page, '[data-testid="presenter"]', "Lindsey Brittain");
    for (const [testid, value] of Object.entries(contract)) await fillField(page, `[data-testid="${testid}"]`, value);
    // Leave permission-line blank; turn the footer bar on.
    await page.check('[data-testid="footer-bar"]');
    await submit(page, 'button:has-text("Save and map beliefs")');

    // The Deck step: the filled lines are slides in order, the blank one is listed, the pictures are counted.
    await page.goto(`${wizardBase}?step=deck`);
    await page.locator('[data-testid="deck-honesty"]').waitFor({ timeout: 20000 });
    const headlines = await page.locator('[data-testid="deck-slide"] [data-testid="deck-headline"]').allInnerTexts();
    // The five filled opening lines appear, in the contract's order, after the cover and before the first act divider.
    const wanted = [contract["promise-line"], contract["chat-prompt"], contract["ground-rule"], "By the end you'll have", contract["session-goal"]];
    const positions = wanted.map((w) => headlines.findIndex((h) => h.trim() === w));
    if (positions.some((p) => p < 0)) throw new Error(`every filled opening line is a slide: ${JSON.stringify(wanted.map((w, i) => [w, positions[i]]))}`);
    for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) throw new Error(`the opening lines are in the coach's order, got ${positions.join(",")}`);
    // The reflection beat sits before the offer, so it appears only once an offer is linked (covered by the unit test); this fresh webinar has none.
    console.log("✓ the filled opening contract is five slides in the coach's order, all the coach's own words");

    // The blank line is listed, not a slide and not a placeholder.
    const omitted = (await page.locator('[data-testid="deck-opening-omitted"]').innerText()).trim();
    if (!/Permission to be direct/.test(omitted) || !/left out/.test(omitted)) throw new Error(`a blank opening line is listed as left out, got "${omitted}"`);
    if (headlines.some((h) => /\[.*\]/.test(h))) throw new Error("a blank opening line is never a placeholder on a face");
    console.log(`✓ the blank line is listed, not shown: "${omitted}"`);

    // Suggested pictures are counted (the cover's photo at least). Empty here, so every slide exports as text.
    const slots = (await page.locator('[data-testid="deck-slots"]').innerText()).trim();
    if (!/suggested picture/.test(slots) || !/exports as text/.test(slots)) throw new Error(`the suggested pictures are counted and named, got "${slots}"`);
    console.log(`✓ suggested pictures counted: "${slots}"`);

    // ── No face carries how the deck was built (A), and one currency per deck (B). ──
    // The words come from the one module the engine reads (deck-face.ts), never typed here: one key point per example, spread over
    // the fresh webinar's sections, each beside an ordinary line that must survive.
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { FACE_LABELS, FACE_WORDS, cleanFace, currenciesIn, faceHits } = await import("@/lib/engine/deck-face");
    const webinarId = wizardBase.split("/").pop()!;
    // Every class: each word example, and a line opening with the first field label ("Real: …", as slide 65 did).
    const examples = [...FACE_WORDS.flatMap((w) => w.examples), `${FACE_LABELS[0]}: most leaders never name the drift.`];
    const secs = await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, webinarId) });
    const targets = secs.filter((x) => !/offer|q_a/.test(x.sectionKey)).sort((a, b) => a.order - b.order);
    if (targets.length < examples.length) throw new Error(`enough sections to carry one example each: ${targets.length} for ${examples.length}`);
    for (const [i, ex] of examples.entries()) await db.update(schema.webinarSections).set({ keyPoints: `Line ${i + 1} the presenter says\n${ex}`, status: "drafted", origin: "coach" }).where(eq(schema.webinarSections.id, targets[i].id));
    const expectedKept = examples.flatMap((ex) => cleanFace(ex).kept.map((k) => k.text));
    await page.goto(`${wizardBase}?step=deck`);
    await page.locator('[data-testid="deck-kept-off"]').waitFor({ timeout: 20000 });
    const keptLines = await page.locator('[data-testid="deck-kept-off-line"]').allInnerTexts();
    if (keptLines.length !== expectedKept.length) throw new Error(`the Deck step lists every kept-off line: ${keptLines.length} for ${expectedKept.length}`);
    for (const k of expectedKept) if (!keptLines.some((l) => l.includes(`“${k}”`))) throw new Error(`the Deck step names "${k}"`);
    const stepHeads = await page.locator('[data-testid="deck-slide"] [data-testid="deck-headline"]').allInnerTexts();
    for (const h of stepHeads) if (faceHits(h).length) throw new Error(`a Deck step headline carries ${faceHits(h).join(", ")}: "${h}"`);
    console.log(`✓ the Deck step keeps ${expectedKept.length} lines off the slides, one per example in deck-face.ts, each named`);

    // The offer: the demo client's own, linked, and a line in the offer stack typed in a currency that is not the offer's.
    const user = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const offer = (await db.query.offers.findFirst({ where: and(eq(schema.offers.userId, user.id), eq(schema.offers.status, "live")) }))!;
    const other = offer.currency === "NZD" ? "AUD" : "NZD";
    await db.update(schema.webinars).set({ offerId: offer.id }).where(eq(schema.webinars.id, webinarId));
    const stack = secs.find((x) => x.sectionKey === "offer_stack_cta")!;
    await db.update(schema.webinarSections).set({ keyPoints: `${other} $${offer.price.toLocaleString()}, paid once.`, status: "drafted", origin: "coach" }).where(eq(schema.webinarSections.id, stack.id));
    const refusedRes = await page.request.get(`${base}/api/webinars/${webinarId}/deck?format=pptx`);
    const refusedBody = (await refusedRes.json().catch(() => ({}))) as { refused?: string[] };
    const currencyLine = (refusedBody.refused ?? []).find((r) => r.includes(`it names ${other}, but the offer is priced in ${offer.currency}`));
    if (refusedRes.status() !== 409 || !currencyLine) throw new Error(`a line in another currency refuses the export, naming its slide: ${refusedRes.status()} ${JSON.stringify(refusedBody).slice(0, 300)}`);
    console.log(`✓ a line in ${other} on a deck priced in ${offer.currency} refuses the export: "${currencyLine}"`);

    // The coach sets the offer's currency to the one they meant; the export goes, and the file is read face by face.
    await db.update(schema.offers).set({ currency: other }).where(eq(schema.offers.id, offer.id));
    const res = await page.request.get(`${base}/api/webinars/${webinarId}/deck?format=pptx`);
    const body = await res.body();
    if (!res.ok() || body.subarray(0, 2).toString() !== "PK") throw new Error(`with one currency the .pptx exports: ${res.status()} ${body.toString("utf8").slice(0, 300)}`);
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(body);
    const unxml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    const slideFiles = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    const faceLines: string[] = [];
    for (const f of slideFiles) {
      const xml = await zip.file(f)!.async("string");
      for (const para of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
        const text = unxml((para.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.replace(/<\/?a:t>/g, "")).join(""));
        if (text.trim()) faceLines.push(text.trim());
      }
    }
    if (slideFiles.length < 10 || faceLines.length < slideFiles.length) throw new Error(`the file has slides with text to read: ${slideFiles.length} slides, ${faceLines.length} lines`);
    const dirty = faceLines.filter((l) => faceHits(l).length);
    if (dirty.length) throw new Error(`a face in the exported file carries construction language: ${dirty.map((l) => `"${l}" (${faceHits(l).join(", ")})`).join("; ")}`);
    for (let i = 1; i <= examples.length; i++) if (!faceLines.includes(`Line ${i} the presenter says`)) throw new Error(`the ordinary line beside example ${i} is still on a face`);
    const named = new Set(faceLines.flatMap(currenciesIn));
    const foreign = [...named].filter((c) => c !== other && c !== "$");
    if (!named.has(other) || foreign.length) throw new Error(`every currency on a face is the offer's ${other}: named ${[...named].join(", ")}`);
    const notes = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")))).map(unxml).join("\n");
    const inNotes = expectedKept.filter((k) => notes.includes(k));
    if (inNotes.length !== expectedKept.length) throw new Error(`every kept-off line is in the speaker notes: ${inNotes.length} of ${expectedKept.length}`);
    console.log(`✓ the .pptx: ${faceLines.length} lines on ${slideFiles.length} faces, none from any class in deck-face.ts; every currency named is ${other}; all ${expectedKept.length} kept-off lines are in the notes`);

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("Deck v2 walk passed.");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
