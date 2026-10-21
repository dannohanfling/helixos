/**
 * The Proof Bank list (H-1393, H-1394), end to end as the coach in their own bank: a very long one-liner no longer pushes the
 * badges off the page at 1440 or 390; the status filter's counts match the bank and Draft shows only drafts; Approve selected
 * with the permission tick approves the ticked drafts and leaves the one whose picture shows a person as a draft, naming it;
 * the clean-list file ticks only its matches and carries the transcript check's corrections (H-1414); without the tick
 * nothing is approved; with it the corrected draft takes its new name and words; Undo the last batch puts them back, words too.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As the coach")');
  await page.waitForURL(/\/today/);
}
async function badgesFit(page: Page, width: number) {
  const vw = await page.evaluate(() => window.innerWidth);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  must(sideways <= 0, `${width}: nothing scrolls sideways (${sideways}px)`);
  const boxes = await page.locator('[data-testid="proof-row"] [data-testid="proof-badge"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  must(boxes.length > 0 && boxes.every((r) => r <= vw), `${width}: every row's badge is inside the page (${boxes.filter((r) => r > vw).length} of ${boxes.length} outside)`);
}

async function main() {
  const { db, schema } = await import("@/db");
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const coach = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
  const cm = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, coach.id) }))!;
  const W = cm.workspaceId;
  const ids = { long: "smoke-bank-long", quote: "smoke-bank-quote", person: "smoke-bank-person", perm: "smoke-bank-perm", done: "smoke-bank-done" };
  const clear = async () => {
    await db.delete(schema.proofAttachments).where(like(schema.proofAttachments.id, "smoke-bank-%"));
    await db.delete(schema.proofs).where(and(eq(schema.proofs.userId, coach.id), like(schema.proofs.id, "smoke-bank-%")));
    await db.delete(schema.proofBatches).where(eq(schema.proofBatches.userId, coach.id));
  };
  await clear();
  const LONG = `"${"Investmentstructure".repeat(20)}"`;
  const row = (id: string, name: string, who: string, extra: Record<string, unknown>) => ({ id, workspaceId: W, userId: coach.id, name, type: "testimonial" as const, who, sourceRecordedAt: "2026-10-20", ...extra });
  await db.insert(schema.proofs).values([
    row(ids.long, "Smoke bank long", "Smoke Maya C.", { resultAfter: LONG, shortVersion: LONG, status: "draft" }),
    row(ids.quote, "Smoke bank quote", "Smoke Leo K.", { quote: '"Smoke booked three calls this week after the rewrite"', resultAfter: '"Smoke booked three calls this week after the rewrite"', status: "draft" }),
    row(ids.person, "Smoke bank person", "Smoke Ann P.", { resultAfter: '"Smoke doubled the list"', status: "draft" }),
    row(ids.perm, "Smoke bank permission", "Smoke Ben R.", { resultAfter: '"Smoke permission given already"', status: "draft", permissionAt: "2026-10-20T10:00:00.000Z", permissionBy: coach.id }),
    row(ids.done, "Smoke bank approved", "Smoke Cal T.", { resultAfter: '"Smoke approved already"', status: "approved", permissionAt: "2026-10-20T10:00:00.000Z", permissionBy: coach.id }),
  ]);
  // A picture that shows a person with no likeness permission recorded: the same gate as a single approval.
  await db.insert(schema.proofAttachments).values({ id: "smoke-bank-att", proofId: ids.person, workspaceId: W, blobKey: "smoke/none.png", blobUrl: "https://example.invalid/smoke/none.png", kind: "image", mime: "image/png", bytes: 10, originalFilename: "none.png", showsAPerson: true, uploadedBy: coach.id });
  const counts = async () => {
    const all = await db.query.proofs.findMany({ where: eq(schema.proofs.userId, coach.id), columns: { status: true, permissionAt: true } });
    return { all: all.length, draft: all.filter((p) => p.status !== "approved" && !p.permissionAt).length, permission: all.filter((p) => p.status !== "approved" && Boolean(p.permissionAt)).length, approved: all.filter((p) => p.status === "approved").length };
  };
  const listDir = mkdtempSync(path.join(tmpdir(), "smoke-bank-"));
  const listFile = path.join(listDir, "list.json");
  const CORRECTED = '"Smoke booked four calls this week after the rewrite"';
  writeFileSync(
    listFile,
    JSON.stringify({
      approve_clean: [{ who: "Smoke Maya C.", date: "2026-10-20", result_starts: LONG.slice(0, 120) }, { who: "Smoke Nobody", date: "2026-10-20", result_starts: '"never here"' }],
      approve_after_transcript_check: [{ who: "Smoke Leo K.", date: "2026-10-20", result_starts: '"Smoke booked three calls', correct_who: "Smoke Leo Kay", corrected_quote: CORRECTED }],
      keep_as_draft: [{ who: "Smoke Ann P.", date: "2026-10-20", result_starts: '"Smoke doubled', why: "Speaker unclear" }],
    }),
  );

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const failures: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
  });
  try {
    await login(page);
    // ── The badges stay on the page, at 1440 and 390, with the long one-liner in the bank; the counts match the bank. ──
    await page.goto(`${base}/proof?status=draft`);
    await page.locator('[data-testid="proof-status-filter"]').waitFor({ timeout: 20000 });
    await badgesFit(page, 1440);
    const c = await counts();
    for (const k of ["all", "draft", "permission", "approved"] as const) must(Number(await page.locator(`[data-testid="proof-status-${k}"]`).getAttribute("data-count")) === c[k], `${k} count matches the bank (${c[k]})`);
    must((await page.locator('[data-testid="proof-row"]').count()) === c.draft && (await page.locator('[data-testid="proof-row"]:not([data-status="draft"])').count()) === 0, "Draft shows only drafts");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/proof?status=draft`);
    await page.locator('[data-testid="proof-status-filter"]').waitFor({ timeout: 20000 });
    await badgesFit(page, 390);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/proof?status=permission`);
    await page.locator('[data-testid="proof-status-filter"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="proof-row"]').count()) === c.permission && (await page.locator(`[data-testid="proof-row"][data-status="permission"]`).count()) === c.permission, "Permission given shows the drafts with their tick recorded");
    console.log("✓ the badges stay in view at 1440 and 390 with a long one-liner; the filter's counts match the bank; Draft and Permission given show their own");

    // ── Approve selected: the clean list ticks its matches; Select all and Clear; the confirm step; no tick, nothing approved. ──
    await page.goto(`${base}/proof?status=draft`);
    await page.locator('[data-testid="proof-bulk"]').waitFor({ timeout: 20000 });
    await page.setInputFiles('[data-testid="proof-list-file"]', listFile);
    await page.locator('[data-testid="proof-list-select"]').click();
    await page.locator('[data-testid="proof-list-result"]').waitFor({ timeout: 20000 });
    must((await page.locator('[data-testid="proof-list-result"]').innerText()).startsWith("2 matched, 1 not found, 1 with a correction"), `the list matches two, misses one, corrects one: ${await page.locator('[data-testid="proof-list-result"]').innerText()}`);
    const picked = async () => page.locator('[data-testid="proof-pick"]:checked').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).sort());
    must(JSON.stringify(await picked()) === JSON.stringify([ids.long, ids.quote].sort()), `only the matches are ticked: ${JSON.stringify(await picked())}`);
    must((await page.locator('[data-testid="proof-selected-count"]').innerText()).startsWith("2 selected"), "the count says 2");
    await page.locator('[data-testid="proof-select-all"]').click();
    must((await picked()).length === c.draft, "Select all shown ticks every draft shown");
    await page.locator('[data-testid="proof-select-none"]').click();
    must((await picked()).length === 0, "Clear unticks");
    for (const id of [ids.long, ids.quote, ids.person]) await page.locator(`[data-testid="proof-pick"][value="${id}"]`).check();
    await page.locator('[data-testid="proof-approve-selected"]').click();
    await page.locator('[data-testid="proof-confirm"]').waitFor({ timeout: 10000 });
    const names = await page.locator('[data-testid="proof-confirm-names"]').innerText();
    must(names.includes("Smoke Maya C.") && names.includes("Smoke Ann P."), `the confirm step names them: ${names}`);
    const corrected = await page.locator('[data-testid="proof-confirm-corrected"]').innerText();
    must(corrected.startsWith("1 will be corrected first") && corrected.includes("Smoke Leo K."), `the confirm step says which the list corrects first: ${corrected}`);
    await Promise.all([page.waitForURL(/bulkError=/, { timeout: 20000 }), page.locator('[data-testid="proof-bulk-approve"]').click()]);
    must((await page.locator('[data-testid="proof-bulk-error"]').innerText()).includes("permission statement"), "without the tick nothing is approved, and it says so");
    must((await counts()).approved === c.approved, "nothing approved without the tick");
    console.log("✓ the clean list ticks only its matches and says which it corrects; Select all and Clear; the confirm step names them; no permission tick, nothing approved");

    // ── With the tick: two approved as on their own page (one corrected from the list first), the one with a person stays a draft; counts move; Undo puts them back, words too. ──
    await page.setInputFiles('[data-testid="proof-list-file"]', listFile);
    await page.locator('[data-testid="proof-list-select"]').click();
    await page.locator('[data-testid="proof-list-result"]').waitFor({ timeout: 20000 });
    await page.locator(`[data-testid="proof-pick"][value="${ids.person}"]`).check();
    must((await picked()).length === 3, "the list's two and the one ticked by hand");
    await page.locator('[data-testid="proof-approve-selected"]').click();
    await page.locator('[data-testid="proof-confirm"]').waitFor({ timeout: 10000 });
    await page.locator('[data-testid="proof-bulk-permission"]').check();
    await Promise.all([page.waitForURL(/approved=2&held=1&corrected=1/, { timeout: 20000 }), page.locator('[data-testid="proof-bulk-approve"]').click()]);
    must((await page.locator('[data-testid="proof-bulk-note"]').innerText()).includes("2 approved (1 corrected from the list first); 1 left as draft"), `the note counts all three: ${await page.locator('[data-testid="proof-bulk-note"]').innerText()}`);
    const after = await db.query.proofs.findMany({ where: inArray(schema.proofs.id, [ids.long, ids.quote, ids.person]) });
    const byId = new Map(after.map((p) => [p.id, p]));
    must(byId.get(ids.long)!.status === "approved" && byId.get(ids.long)!.permissionBy === coach.id && Boolean(byId.get(ids.long)!.permissionAt) && byId.get(ids.quote)!.status === "approved", "the two are approved with the permission recorded by the coach");
    must(byId.get(ids.quote)!.who === "Smoke Leo Kay" && byId.get(ids.quote)!.quote === CORRECTED && byId.get(ids.quote)!.resultAfter === CORRECTED && byId.get(ids.quote)!.name === "Smoke bank quote", `the corrected draft has its new name and words, its own title kept: ${byId.get(ids.quote)!.who} / ${byId.get(ids.quote)!.quote}`);
    must(byId.get(ids.person)!.status === "draft" && !byId.get(ids.person)!.permissionAt, "the one whose picture shows a person stays a draft, untouched");
    const c2 = await counts();
    must(c2.approved === c.approved + 2 && Number(await page.locator('[data-testid="proof-status-approved"]').getAttribute("data-count")) === c2.approved, "the Approved count rose by two");
    const batch = (await db.query.proofBatches.findFirst({ where: eq(schema.proofBatches.userId, coach.id) }))!;
    must(batch.proofIds.length === 2 && !batch.undoneAt && batch.corrections.length === 1 && batch.corrections[0].id === ids.quote && batch.corrections[0].before.who === "Smoke Leo K.", "the batch is recorded with what the correction replaced");
    await Promise.all([page.waitForURL(/undone=2&restored=1/, { timeout: 20000 }), page.locator('[data-testid="proof-undo-batch"]').click()]);
    const back = await db.query.proofs.findMany({ where: inArray(schema.proofs.id, [ids.long, ids.quote]) });
    must(back.every((p) => p.status === "draft" && p.permissionAt), "Undo puts both back to draft, keeping the record of the tick");
    const leo = back.find((p) => p.id === ids.quote)!;
    must(leo.who === "Smoke Leo K." && leo.quote === '"Smoke booked three calls this week after the rewrite"' && leo.resultAfter === leo.quote, `Undo puts the old name and words back: ${leo.who} / ${leo.quote}`);
    must(Boolean((await db.query.proofBatches.findFirst({ where: eq(schema.proofBatches.id, batch.id) }))!.undoneAt), "the batch is marked undone");
    must((await page.locator('[data-testid="proof-undo-batch"]').count()) === 0, "a batch undoes once");
    console.log("✓ with the tick: two approved as on their own page, one corrected from the list first, the one with a person named and left as a draft, the Approved count up by two; Undo the last batch puts them back with their old words, once");
  } finally {
    await browser.close();
    await clear();
  }
  if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
  console.log("The Proof Bank walk passed");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
