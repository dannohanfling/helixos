/**
 * Avatars by interview (rev 636, answered rev 639), as Maya with her AI key against scripts/mock-ai.ts: Interview me on Avatars,
 * a long answer moves on and a short one gets one follow-up, a question skipped, "That's enough, show me", the draft in her own
 * words (an invented phrase, an invented number and a field with no answer behind it each dropped and listed), Keep and Skip
 * and an edit, Save avatar writing only what was kept, the offer link after saving, an existing avatar's interview asking only
 * its empty fields and never overwriting one filled meanwhile, stop and pick up, the coach seeing the answers behind the avatar,
 * no key saying so, and the same interview by voice over the connector's route.
 */
import { spawn } from "node:child_process";
import { chromium, type Page } from "@playwright/test";

// The server's own secret, so the AI key sealed here opens there.
process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
async function login(page: Page, who: "As a client" | "As the coach") {
  await page.goto(`${base}/login`);
  await page.click(`button:has-text("${who}")`);
  await page.waitForURL(/\/today/);
}
async function logout(page: Page) {
  await page.goto(`${base}/settings`);
  await page.locator('button:has-text("Log out")').first().click();
  await page.waitForURL(/\/login/);
}
/** Clicks a submit and waits for the page the server action sends us to. */
async function press(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ timeout: 20000 });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.locator(selector).first().click()]);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}
const question = async (page: Page) => (await page.locator('[data-testid="interview-question"]').innerText()).trim();
async function answer(page: Page, text: string) {
  await page.locator('[data-testid="interview-answer"]').fill(text);
  await press(page, '[data-testid="interview-submit"]');
}

async function main() {
  const mock = spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  const failures: string[] = [];
  try {
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { INTERVIEW_QUESTIONS } = await import("@/lib/engine/avatar-interview");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = m.workspaceId;
    const setKey = async (on: boolean) => {
      await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, maya.id)));
      if (on) await db.insert(schema.aiCredentials).values({ id: newId(), workspaceId: ws, userId: maya.id, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
    };
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    page.on("response", (r) => {
      if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`);
    });

    // No key: the page says so instead of offering it.
    await setKey(false);
    await login(page, "As a client");
    await page.goto(`${base}/avatars`);
    must((await page.locator('[data-testid="interview-no-key"]').innerText()).includes("Add your AI key in Settings to be interviewed"), "without a key the page says to add one");
    must(!(await page.locator('[data-testid="interview-start"]').count()), "and offers no Interview me");
    await setKey(true);
    console.log("✓ no AI key: Interview me isn't offered, the page says to add the key");

    // Interview me: a long answer moves on, a short one gets one follow-up, a question skipped, then "That's enough, show me".
    await page.goto(`${base}/avatars`);
    await press(page, '[data-testid="interview-start"]');
    await page.waitForURL(/\/avatars\/interview\//);
    const interviewId = page.url().split("/").pop()!.split("?")[0];
    must((await question(page)) === INTERVIEW_QUESTIONS.who, "the first question is who they are");
    await answer(page, "Moms who run a small online business from home");
    must((await question(page)) === INTERVIEW_QUESTIONS.pains, `a full answer moves on: ${await question(page)}`);
    await answer(page, "Overwhelm");
    must((await question(page)) === "What did that cost them?", "a short answer gets one follow-up");
    await answer(page, "Missed school pickups and a launch that flopped");
    must((await question(page)) === INTERVIEW_QUESTIONS.wants, "then the next field");
    await answer(page, "To make $4,200 a month working 20 hours a week");
    await press(page, '[data-testid="interview-skip"]');
    must((await question(page)) === INTERVIEW_QUESTIONS.objections, "a skipped question moves on");
    await answer(page, "They say they will start after the holidays, every single time");
    await answer(page, "Facebook groups for mompreneurs and a few podcasts");
    must((await question(page)) === INTERVIEW_QUESTIONS.phrases, "the words they use");
    await answer(page, "I never get a minute, I'm always behind");
    await press(page, '[data-testid="interview-enough"]');
    console.log("✓ the interview: one question at a time, a follow-up on a thin answer only, a skip, and That's enough, show me");

    // The draft: their own words; an invented phrase, an invented number and a field with no answer behind it are listed.
    await page.locator('[data-testid="interview-draft"]').waitFor();
    const dropped = await page.locator('[data-testid="interview-dropped"]').innerText();
    must(dropped.includes("I'm drowning in admin") && dropped.includes("Doubles revenue in 47 days") && dropped.includes("Not for: no answer behind it"), `left out, listed: ${dropped}`);
    must((await page.locator('[name="text_phrases"]').inputValue()) === "I never get a minute", "the phrase they said stays, word for word");
    must((await page.locator('[name="text_wants"]').inputValue()) === "To make $4,200 a month working 20 hours a week", "their number stays, the invented one goes");
    must(await page.locator('[data-testid="interview-notcovered-tried"]').count(), "a skipped field is not covered");
    must((await page.locator('[data-testid="interview-summary"]').innerText()).startsWith("6 of 10 filled from your answers; left out: 3 things you didn't say"), "the summary");
    // Keep, Skip and an edit; a name.
    await page.locator('[name="name"]').fill("Interview walk avatar");
    await page.locator('[name="text_who"]').fill("Moms who run a small online business from home (edited)");
    await page.locator('[data-testid="interview-skip-wants"]').check();
    await press(page, '[data-testid="interview-save"]');
    await page.waitForURL(/\/avatars\/[\w-]+\?saved=interview/);
    must((await page.locator('[data-testid="avatar-saved"]').innerText()).includes("Who is this avatar for?"), "saved, and asked who it's for");
    const avatarId = page.url().split("/avatars/")[1].split("?")[0];
    let av = (await db.query.avatars.findFirst({ where: eq(schema.avatars.id, avatarId) }))!;
    must(av.name === "Interview walk avatar" && av.who === "Moms who run a small online business from home (edited)" && av.wants === null && av.phrases === "I never get a minute" && av.pains?.includes("Overwhelm") && av.tried === null && av.notFor === null, `only the kept fields saved: ${JSON.stringify(av)}`);
    must((await db.query.avatarInterviews.findFirst({ where: eq(schema.avatarInterviews.id, interviewId) }))!.savedAvatarId === avatarId, "the interview is marked saved against it");
    must(await page.locator('text=from an interview').count(), "the avatar says it came from an interview");
    // Who is it for: the offer link on the same page.
    const link = page.locator('[data-testid="avatar-link"]');
    if (await link.count()) {
      const offer = await link.locator("option:not([disabled])").first().getAttribute("value");
      await link.locator("select").selectOption(offer!);
      await press(page, '[data-testid="avatar-link"] button');
      must(await db.query.avatarOffers.findFirst({ where: and(eq(schema.avatarOffers.avatarId, avatarId), eq(schema.avatarOffers.offerId, offer!)) }), "linked to the offer picked");
    }
    console.log("✓ the draft in her words, three things left out and listed; Keep, Skip and an edit; only the kept fields saved; linked to an offer");

    // An existing avatar: only its empty fields are asked, and one filled meanwhile is never overwritten.
    await page.goto(`${base}/avatars/${avatarId}`);
    await press(page, '[data-testid="interview-start"]');
    await page.waitForURL(/\/avatars\/interview\//);
    must((await question(page)) === INTERVIEW_QUESTIONS.wants, `the first empty field: ${await question(page)}`);
    await answer(page, "Weekends off with the kids, and a business that pays the mortgage");
    await answer(page, "Hired a VA, bought two courses, tried batching content on Sundays");
    // Meanwhile she fills "wants" by hand on the avatar's page.
    await db.update(schema.avatars).set({ wants: "Typed by hand meanwhile" }).where(eq(schema.avatars.id, avatarId));
    await press(page, '[data-testid="interview-enough"]');
    await page.locator('[data-testid="interview-draft"]').waitFor();
    must(!(await page.locator('[name="name"]').count()), "no name asked for an existing avatar");
    await press(page, '[data-testid="interview-save"]');
    av = (await db.query.avatars.findFirst({ where: eq(schema.avatars.id, avatarId) }))!;
    must(av.wants === "Typed by hand meanwhile" && av.tried?.startsWith("Hired a VA") && av.who?.endsWith("(edited)"), `filled fields untouched, empty ones filled: ${JSON.stringify(av)}`);
    console.log("✓ an existing avatar: only its empty fields asked; a field filled meanwhile kept as it was");

    // Stop and pick up: a new interview, one answer, away and back; then stopped.
    await page.goto(`${base}/avatars`);
    await press(page, '[data-testid="interview-start"]');
    await answer(page, "Solo accountants who want fewer clients and higher fees");
    await page.goto(`${base}/avatars`);
    await page.locator('[data-testid="interview-going"] a').first().click();
    await page.waitForURL(/\/avatars\/interview\//);
    must((await question(page)) === INTERVIEW_QUESTIONS.pains, "picked up at the next question");
    await press(page, '[data-testid="interview-stop"]');
    must(!(await page.locator('[data-testid="interview-going"]').count()), "a stopped interview isn't offered to pick up");
    console.log("✓ stop and pick up: back at the next question; stopped, it's gone from the list with its answers kept");

    // By voice: the same interview over the connector's route.
    const { viewerFor } = await import("@/lib/auth");
    const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
    const { createHash, randomBytes } = await import("node:crypto");
    const v = (await viewerFor(maya.id, ws))!;
    const client = await registerClient("Walk interview", [CALLBACK]);
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["offers"] as never });
    const pair = (await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` })) as { access_token: string };
    let rpcId = 0;
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await (await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${pair.access_token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) })).json()) as { result?: { content?: { text: string }[]; isError?: boolean } };
      return { text: res.result?.content?.[0]?.text ?? "", isError: Boolean(res.result?.isError) };
    };
    let r = await tool("avatar_interview_start");
    must(!r.isError && r.text.includes(INTERVIEW_QUESTIONS.who), `voice: the first question: ${r.text.slice(0, 160)}`);
    r = await tool("avatar_interview_answer", { answer: "Retired teachers starting a tutoring side business" });
    must(r.text.includes(INTERVIEW_QUESTIONS.pains), "voice: the next question");
    r = await tool("avatar_interview_status");
    must(r.text.includes(INTERVIEW_QUESTIONS.pains), "voice: status says where it stands");
    r = await tool("avatar_interview_answer", { answer: "They undercharge and feel awkward asking for money", enough: true });
    must(r.text.includes("The draft for a new avatar is ready") && r.text.includes("Nothing is saved yet") && r.text.includes("/avatars/interview/"), `voice: the draft and where to keep it: ${r.text.slice(0, 200)}`);
    console.log("✓ by voice: start, answer, status and the draft over the connector, saved only in the app");

    // The coach sees that the avatar came from an interview, and the answers.
    await logout(page);
    await login(page, "As the coach");
    await page.goto(`${base}/coach/${m.id}`);
    const behind = page.locator('[data-testid="coach-avatar-interview"]').first();
    await behind.waitFor({ timeout: 15000 });
    await behind.locator("summary").click();
    must((await behind.innerText()).includes("Missed school pickups") && (await behind.innerText()).includes("Hired a VA"), "the coach reads the answers behind the avatar");
    console.log("✓ the coach sees from an interview on the avatar, with its answers");

    if (failures.length) throw new Error(`server errors: ${failures.join(", ")}`);
    console.log("\ninterview walk passed");
  } finally {
    await browser.close();
    try {
      process.kill(-mock.pid!);
    } catch {}
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
