/**
 * Move to a client's workspace (handoff 27 Sep), walked as the coach meets it, against the demo database:
 * - the page lists only the coach's own items, by kind, each with a tick box;
 * - picking a webinar and a proof shows the plan: the webinar carries its offer, its belief proof, its story and its deck image,
 *   the proof carries its client record; a story the coach's other webinar also uses stays, and a story in the coach's Essence
 *   can't move, and both are said; an offer on the coach's bot is flagged;
 * - a plan that changed since it was shown moves nothing and says so;
 * - Move changes only the owner: every row in the plan is the client's, children followed, the proof kept its permission record,
 *   nothing else moved; the client sees them on their pages, the coach's pages and bot no longer carry them.
 * Every expected value is read from the database or the planner, never typed from memory.
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 6);

async function submit(page: Page, selector: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { stage1InputFor } = await import("@/lib/community-loyalty");

  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const coachM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const mayaM = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
  const ws = coachM.workspaceId;
  const id = () => randomUUID();

  // ── The coach's workspace with a client's things mixed in, plus the coach's own that share with them. ──
  const ids = { offer: id(), gs: id(), proof: id(), kate: id(), web: id(), own: id(), story: id(), shared: id(), image: id(), magnet: id() };
  const T = (s: string) => `${s} ${RUN}`;
  await db.insert(schema.offers).values([
    { id: ids.offer, workspaceId: ws, userId: coach.id, name: T("90-Minute Diagnostic"), price: 1950, currency: "NZD", botRole: "one_on_one" },
    { id: ids.gs, workspaceId: ws, userId: coach.id, name: T("Get started"), price: 500 },
  ]);
  await db.insert(schema.offerComponents).values({ id: id(), offerId: ids.offer, name: T("Diagnostic call"), type: "core" });
  await db.insert(schema.clientRecords).values({ id: ids.kate, workspaceId: ws, userId: coach.id, name: T("Kate") });
  await db.insert(schema.proofs).values({ id: ids.proof, workspaceId: ws, userId: coach.id, name: T("Kate: identity"), who: "Kate", shortVersion: "Kate named the drift.", status: "approved", permissionAt: "2026-06-01T00:00:00Z", permissionBy: coach.id, clientRecordId: ids.kate });
  await db.insert(schema.libraryAssets).values([
    { id: ids.story, workspaceId: ws, userId: coach.id, type: "story", name: T("The drift"), body: "Her story." },
    { id: ids.shared, workspaceId: ws, userId: coach.id, type: "story", name: T("First week"), body: "His story." },
  ]);
  await db.insert(schema.deckImages).values({ id: ids.image, workspaceId: ws, userId: coach.id, kind: "photo", blobKey: `deck/${ws}/${RUN}.jpg`, blobUrl: `https://blob.example/${RUN}.jpg`, mime: "image/jpeg", caption: T("Turas slide") });
  await db.insert(schema.webinars).values([
    { id: ids.web, workspaceId: ws, userId: coach.id, title: T("Your Edge, Uncovered"), offerId: ids.offer },
    { id: ids.own, workspaceId: ws, userId: coach.id, title: T("It Goes Down In The DMs"), offerId: ids.gs },
  ]);
  await db.insert(schema.webinarBeliefs).values([
    { id: id(), webinarId: ids.web, type: "vehicle", proofId: ids.proof, storyAssetId: ids.story },
    { id: id(), webinarId: ids.web, type: "internal", storyAssetId: "essence:0" },
    { id: id(), webinarId: ids.own, type: "vehicle", storyAssetId: ids.shared },
  ]);
  await db.insert(schema.webinarSections).values({ id: id(), webinarId: ids.web, sectionKey: "opening-1", act: "opening", order: 1, name: T("Open"), assetId: ids.shared });
  await db.insert(schema.deckSlots).values({ id: id(), webinarId: ids.web, slotKey: "opening-1", imageId: ids.image });
  await db.insert(schema.leadMagnets).values({ id: ids.magnet, workspaceId: ws, userId: coach.id, title: T("DM scripts"), keyword: `DMS${RUN}`, slug: `dms-${RUN}`, offerId: ids.gs });
  const essence = await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, ws), eq(schema.essences.userId, coach.id)) });
  const essenceName = ((essence?.data as { representative_stories?: { stories?: { name?: string }[] } } | undefined)?.representative_stories?.stories?.[0]?.name) || "an Essence story";

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });
    const signIn = async (who: "coach" | "client") => {
      await page.goto(`${base}/login`);
      await page.click(`button:has-text("${who === "coach" ? "As the coach" : "As a client"}")`);
      await page.waitForURL(/\/today/);
    };

    // ── A client can't open it. ──
    await signIn("client");
    await page.goto(`${base}/coach/move`);
    await page.waitForURL(/\/today$/, { timeout: 15000 }).catch(() => undefined);
    if (!page.url().endsWith("/today") || (await page.locator('[data-testid="move-pick"]').count())) throw new Error("the move page is the coach's only");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);

    // ── The coach picks a client, the webinar and the proof, and sees the plan. ──
    await signIn("coach");
    await page.goto(`${base}/coach`);
    await Promise.all([page.waitForURL(/\/coach\/move/), page.locator('[data-testid="coach-move-link"]').click()]);
    const items = await page.locator('[data-testid="move-item"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const coachOffers = await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, ws), eq(schema.offers.userId, coach.id)) });
    const mayaOffers = await db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, ws), eq(schema.offers.userId, maya.id)) });
    if (!coachOffers.every((o) => items.includes(`offer:${o.id}`)) || mayaOffers.some((o) => items.includes(`offer:${o.id}`)) || items.some((v) => v.startsWith("asset:") || v.startsWith("client_record:"))) throw new Error("the page lists every offer of the coach's own and none of a client's, and never a bank entry or client record on its own");
    await page.locator('[data-testid="move-client"]').selectOption(mayaM.id);
    await page.locator(`[data-testid="move-item"][value="webinar:${ids.web}"]`).check();
    await page.locator(`[data-testid="move-item"][value="proof:${ids.proof}"]`).check();
    await Promise.all([page.waitForURL(/pick=/), page.locator('[data-testid="move-preview"]').click()]);
    const plan = page.locator('[data-testid="move-plan"]');
    await plan.waitFor({ timeout: 20000 });
    const rows = await page.locator('[data-testid="move-row"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-kind")}:${e.getAttribute("data-why")}`));
    const want = ["webinar:picked", "offer:carried", "proof:picked", "image:carried", "asset:carried", "client_record:carried"];
    if (JSON.stringify(rows) !== JSON.stringify(want)) throw new Error(`the plan: the webinar and proof, with the offer, image, story and client record they carry, got ${rows.join(", ")}`);
    const cannot = (await page.locator('[data-testid="move-cannot"]').allInnerTexts()).join(" | ");
    if (!cannot.includes(T("First week")) || !cannot.includes(T("It Goes Down In The DMs")) || !cannot.includes(`"${essenceName}"`)) throw new Error(`the shared story and the Essence story stay, and both are said, got ${cannot}`);
    if (!(await page.locator('[data-testid="move-warning"]').allInnerTexts()).some((w) => w.includes(T("90-Minute Diagnostic")) && w.includes("on your bot"))) throw new Error("an offer on the coach's bot is flagged");
    console.log(`✓ the plan to ${maya.name}: ${want.length} rows (webinar and proof picked; offer, image, story and client record carried); the shared story and the Essence story stay, said; the bot offer flagged`);

    // ── A plan that changed since it was shown moves nothing. ──
    // The shared story's other user lets go of it: the plan now carries it too, so the key the page holds no longer matches.
    await db.update(schema.webinarBeliefs).set({ storyAssetId: null }).where(eq(schema.webinarBeliefs.webinarId, ids.own));
    await submit(page, '[data-testid="move-go"]');
    await page.locator('[data-testid="move-changed"]').waitFor({ timeout: 20000 });
    if ((await db.query.webinars.findFirst({ where: eq(schema.webinars.id, ids.web) }))!.userId !== coach.id) throw new Error("a changed plan moves nothing");
    const rows2 = await page.locator('[data-testid="move-row"]').count();
    if (rows2 !== want.length + 1) throw new Error(`the new plan carries the story no one else uses now, got ${rows2}`);
    console.log("✓ the plan changed after it was shown (the shared story freed): nothing moved, and the new plan shown, now carrying it");

    // ── Move. ──
    await submit(page, '[data-testid="move-go"]');
    await page.locator('[data-testid="move-done"]').waitFor({ timeout: 20000 });
    const owner = async <T extends { id: string; userId: string | null }>(q: Promise<T | undefined>) => (await q)?.userId;
    const moved = [
      await owner(db.query.webinars.findFirst({ where: eq(schema.webinars.id, ids.web) })),
      await owner(db.query.offers.findFirst({ where: eq(schema.offers.id, ids.offer) })),
      await owner(db.query.proofs.findFirst({ where: eq(schema.proofs.id, ids.proof) })),
      await owner(db.query.clientRecords.findFirst({ where: eq(schema.clientRecords.id, ids.kate) })),
      await owner(db.query.deckImages.findFirst({ where: eq(schema.deckImages.id, ids.image) })),
      await owner(db.query.libraryAssets.findFirst({ where: eq(schema.libraryAssets.id, ids.story) })),
      await owner(db.query.libraryAssets.findFirst({ where: eq(schema.libraryAssets.id, ids.shared) })),
    ];
    const stayed = [await owner(db.query.webinars.findFirst({ where: eq(schema.webinars.id, ids.own) })), await owner(db.query.offers.findFirst({ where: eq(schema.offers.id, ids.gs) })), await owner(db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.id, ids.magnet) }))];
    if (moved.some((u) => u !== maya.id) || stayed.some((u) => u !== coach.id)) throw new Error(`the plan's rows are the client's and nothing else moved, got ${JSON.stringify({ moved, stayed })}`);
    const proof = (await db.query.proofs.findFirst({ where: eq(schema.proofs.id, ids.proof) }))!;
    if (proof.permissionBy !== coach.id || proof.permissionAt !== "2026-06-01T00:00:00Z" || proof.status !== "approved") throw new Error("the proof keeps its permission record and its approval");
    if ((await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, ids.offer) })).length !== 1 || (await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, ids.web) })).length !== 1) throw new Error("children follow their parent, untouched");
    const botOffers = (await stage1InputFor(coachM)).offers.map((o) => o.id);
    if (botOffers.includes(ids.offer)) throw new Error("the coach's bot no longer carries the moved offer");
    console.log(`✓ moved ${moved.length} rows to ${maya.name}; the coach's other webinar, offer and lead magnet stayed; the proof kept its permission record; children followed; the coach's bot no longer carries the offer`);

    await page.goto(`${base}/offers`);
    if ((await page.content()).includes(T("90-Minute Diagnostic"))) throw new Error("the coach's Offers no longer list it");
    await page.goto(`${base}/settings`);
    await page.click('button:has-text("Log out")');
    await page.waitForURL(/\/login/);
    await signIn("client");
    await page.goto(`${base}/webinars`);
    await page.getByText(T("Your Edge, Uncovered")).first().waitFor({ timeout: 15000 });
    await page.goto(`${base}/proof`);
    await page.getByText(T("Kate: identity")).first().waitFor({ timeout: 15000 });
    console.log(`✓ ${maya.name} sees the webinar and the proof on her own pages; the coach's Offers page no longer lists the offer`);
  } finally {
    const all = Object.values(ids);
    await db.delete(schema.webinars).where(inArray(schema.webinars.id, all));
    await db.delete(schema.offers).where(inArray(schema.offers.id, all));
    await db.delete(schema.proofs).where(inArray(schema.proofs.id, all));
    await db.delete(schema.clientRecords).where(inArray(schema.clientRecords.id, all));
    await db.delete(schema.libraryAssets).where(inArray(schema.libraryAssets.id, all));
    await db.delete(schema.deckImages).where(inArray(schema.deckImages.id, all));
    await db.delete(schema.leadMagnets).where(inArray(schema.leadMagnets.id, all));
    await browser.close();
  }
  if (failures.length) throw new Error(`Server errors:\n${failures.join("\n")}`);
  console.log("Move smoke passed");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
