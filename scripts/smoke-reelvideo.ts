/**
 * Reel to Post, PR B (H-1948, plan H-1953): New from a reel with the video.
 *
 * 1. With no model store answering, choosing a video says writing it out isn't switched on yet, and the privacy line shows.
 *    Attach is ticked; Create post uploads the video into the private store, records it (read back and sniffed), and the
 *    reel ladder carries it: its card plays it from /api/reel-videos/<id>, another member's video reads as nothing, and
 *    Remove the video takes it out of the post and the store.
 * 2. With a model store (REEL_TEST_STORE: a folder holding manifest.json, runtime/, models/ and fixtures/speech.wav, served
 *    here on :4095, which the dev server's REEL_MODELS_URL points at), choosing a spoken clip offers "Write it out on this
 *    device" with the download size; the browser listens to it, in Chromium on this machine, with nothing sent anywhere but
 *    the model files read from the store, and the transcript box fills with the words (test case 1). A silent clip says
 *    almost no talking was heard (test case 3), and the model is then "Ready on this device". Without REEL_TEST_STORE the
 *    walk says that part was skipped.
 * 3. At 390 wide the page doesn't scroll sideways.
 * Everything the walk makes is removed after.
 */
import { chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";

process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const BLOB = "http://localhost:4050";
const STORE = process.env.REEL_TEST_STORE ?? "";
const STORE_PORT = 4095;
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};

/** A stand-in MP4: the "ftyp" box the server sniffs, then filler. Not playable, which the walk doesn't need. */
const fakeMp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isommp42"), Buffer.alloc(4096, 7)]);

/** Twelve seconds of near silence as a 16 kHz WAV. */
function silentWav(seconds = 12): Buffer {
  const n = seconds * 16000;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i * 0.37) * 3), 44 + i * 2);
  return b;
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".onnx": "application/octet-stream", ".txt": "text/plain" };
function serveStore(root: string): http.Server {
  return http
    .createServer((req, res) => {
      const p = normalize(join(root, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)));
      res.setHeader("access-control-allow-origin", "*");
      if (!p.startsWith(normalize(root)) || p.includes(`${normalize(root)}/fixtures`) || !existsSync(p) || statSync(p).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "content-length": statSync(p).size });
      createReadStream(p).pipe(res);
    })
    .listen(STORE_PORT);
}

async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto(`${base}/login`);
  await page.click('button:has-text("As a client")');
  await page.waitForURL(/\/today/);
}

async function main() {
  const procs: ChildProcess[] = [];
  const blobUp = await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false);
  if (!blobUp) procs.push(spawn("npx", ["tsx", "scripts/mock-blob.ts", "4050"], { stdio: "ignore", detached: true }));
  procs.push(spawn("npx", ["tsx", "scripts/mock-ai.ts", "4020"], { stdio: "ignore", detached: true }));
  for (let i = 0; i < 40 && !(await fetch(`${BLOB}/__list`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 2000));
  must(!(await fetch(`http://localhost:${STORE_PORT}/manifest.json`).then((r) => r.ok).catch(() => false)), `nothing else may answer on :${STORE_PORT} when the walk starts`);

  const { db, schema } = await import("@/db");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { seal } = await import("@/lib/crypto");
  const { newId } = await import("@/lib/ids");
  const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
  const mm = (await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, maya.id), eq(schema.memberships.role, "client")) }))!;
  const ws = mm.workspaceId;
  const hadKey = await db.query.aiCredentials.findFirst({ where: and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, maya.id)) });
  const keyId = newId();
  if (!hadKey) await db.insert(schema.aiCredentials).values({ id: keyId, workspaceId: ws, userId: maya.id, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
  const before = new Set((await db.query.ladders.findMany({ where: eq(schema.ladders.userId, maya.id), columns: { id: true } })).map((l) => l.id));
  const strangerVideo = newId();
  await db.insert(schema.mediaVideos).values({ id: strangerVideo, workspaceId: ws, userId: "someone-else", blobKey: `reels/${ws}/someone-else/${strangerVideo}.mp4`, blobUrl: `${BLOB}/nowhere.mp4`, mime: "video/mp4", bytes: 10, originalFilename: "theirs.mp4" });
  let store: http.Server | null = null;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
  try {
    const page = await (await browser.newContext()).newPage();
    await login(page);

    // 1. No model store: paste still works, the video still attaches.
    await page.goto(`${base}/content/reel`);
    await page.getByTestId("reel-form").waitFor();
    must((await page.getByTestId("reel-privacy").innerText()).includes("isn't uploaded for that"), "the privacy line says writing it out stays on the device");
    await page.getByTestId("reel-file").setInputFiles({ name: "my-reel.mp4", mimeType: "video/mp4", buffer: fakeMp4 });
    await page.getByTestId("reel-file-chosen").waitFor();
    await page.getByTestId("reel-listen-off").waitFor({ timeout: 15000 });
    must(!(await page.getByTestId("reel-listen").count()), "no Write it out button without a model store");
    must(await page.getByTestId("reel-attach").isChecked(), "Attach is ticked for a video under 200 MB");
    await page.fill('[data-testid="reel-transcript-input"]', "I used to plan every Sunday and by Tuesday the plan was dead. Plan on Tuesday in ten minutes instead.");
    await page.getByTestId("reel-create").click();
    await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+\?reel=new/i, { timeout: 60000 });
    const withVideo = new URL(page.url()).pathname.split("/").pop()!;
    const row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, withVideo) }))!;
    must(row.videoId, "the reel ladder carries the attached video");
    const vid = (await db.query.mediaVideos.findFirst({ where: eq(schema.mediaVideos.id, row.videoId!) }))!;
    must(vid.userId === maya.id && vid.mime === "video/mp4" && vid.bytes === fakeMp4.length && vid.blobKey === `reels/${ws}/${maya.id}/${vid.id}.mp4` && vid.originalFilename === "my-reel.mp4", `the video is recorded as hers, sniffed and sized from the store: ${JSON.stringify({ ...vid, blobUrl: "…" })}`);
    await page.getByTestId("reel-attached").waitFor();
    must((await page.getByTestId("reel-attached-player").getAttribute("src")) === `/api/reel-videos/${vid.id}`, "the card plays it from its own private route");
    const got = await page.request.get(`${base}/api/reel-videos/${vid.id}`);
    must(got.status() === 200 && got.headers()["content-type"] === "video/mp4" && (await got.body()).equals(fakeMp4) && /no-store/.test(got.headers()["cache-control"] ?? ""), `she reads her own video back, uncached (${got.status()})`);
    const ranged = await page.request.get(`${base}/api/reel-videos/${vid.id}`, { headers: { range: "bytes=0-15" } });
    must(ranged.status() === 206 && (await ranged.body()).length === 16, `a range read seeks (${ranged.status()})`);
    const theirs = await page.request.get(`${base}/api/reel-videos/${strangerVideo}`);
    must(theirs.status() === 404, `another member's video reads as nothing (${theirs.status()})`);
    console.log("✓ no model store: the not-switched-on note; Attach uploads, records and plays her video; another member's reads as nothing");

    // The composer offers it as a video of hers.
    const { reelVideoMedia } = await import("@/lib/queries/compose");
    must(reelVideoMedia(vid).id === `vid:${vid.id}` && reelVideoMedia(vid).kind === "video", "the composer offers the reel video under vid:<id>");

    await page.getByTestId("reel-video-remove").click();
    await page.waitForURL(/part=video-removed/);
    must(!(await db.query.mediaVideos.findFirst({ where: eq(schema.mediaVideos.id, vid.id) })), "Remove the video deletes its record");
    must(!(await db.query.ladders.findFirst({ where: eq(schema.ladders.id, withVideo) }))!.videoId, "and the ladder no longer carries it");
    const gone = await page.request.get(`${base}/api/reel-videos/${vid.id}`);
    must(gone.status() === 404, "and it can't be read any more");
    const keys = ((await (await fetch(`${BLOB}/__list`)).json()) as { objects: { pathname: string }[] }).objects.map((o) => o.pathname);
    must(!keys.includes(vid.blobKey), "and the file is gone from the store");
    console.log("✓ Remove the video takes it out of the post, the store and the record");

    // 2. With a model store: written out on this device.
    if (STORE && existsSync(join(STORE, "manifest.json"))) {
      store = serveStore(STORE);
      const manifest = JSON.parse(readFileSync(join(STORE, "manifest.json"), "utf8")) as { tiers: Record<string, { bytes: number }> };
      await page.goto(`${base}/content/reel`);
      await page.getByTestId("reel-form").waitFor();
      await page.getByTestId("reel-file").setInputFiles({ name: "talking.wav", mimeType: "audio/wav", buffer: readFileSync(join(STORE, "fixtures", "speech.wav")) });
      await page.getByTestId("reel-listen").waitFor({ timeout: 15000 });
      const sizeLine = await page.getByTestId("reel-model-size").innerText();
      must(/First time only/.test(sizeLine) && /Use Wi-Fi/.test(sizeLine) && sizeLine.includes(`about ${Math.round(manifest.tiers.base.bytes / 10_000_000) * 10} MB`), `the download size shows before the first run: ${sizeLine}`);
      must(!(await page.getByTestId("reel-attach").count()), "a sound file can be written out but isn't offered as the post's video");
      const started = Date.now();
      await page.getByTestId("reel-listen").click();
      await page.getByTestId("reel-listen-progress").waitFor({ timeout: 15000 });
      await page.getByTestId("reel-listen-done").waitFor({ timeout: 240000 });
      const words = (await page.inputValue('[data-testid="reel-transcript-input"]')).toLowerCase();
      must(words.includes("dashwood") && words.includes("selfish") && words.includes("respectable"), `the transcript holds the clip's words: ${words.slice(0, 200)}`);
      console.log(`✓ written out on this device in ${Math.round((Date.now() - started) / 1000)} s: "${words.slice(0, 70)}…"`);

      await page.getByTestId("reel-file").setInputFiles({ name: "music-only.wav", mimeType: "audio/wav", buffer: silentWav() });
      await page.getByTestId("reel-listen").waitFor();
      must((await page.getByTestId("reel-model-size").innerText()).includes("Ready on this device"), "the second time the model is already kept");
      await page.getByTestId("reel-listen").click();
      await page.getByTestId("reel-silent").waitFor({ timeout: 120000 });
      console.log("✓ a reel with no talking says so and asks for a description; the model is kept for next time");

      await page.fill('[data-testid="reel-transcript-input"]', words);
      await page.getByTestId("reel-create").click();
      await page.waitForURL(/\/content\/ladders\/[a-z0-9-]+\?reel=new/i, { timeout: 60000 });
      const written = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, new URL(page.url()).pathname.split("/").pop()!) }))!;
      must(written.sourceTranscript?.toLowerCase().includes("dashwood") && !written.videoId, "the post is written from the words, with no video when Attach was unticked");
      console.log("✓ Create post writes the package from the words written out here");
    } else {
      console.log("· writing it out on the device was not walked: REEL_TEST_STORE is not set");
    }

    // 3. Phone width.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/content/reel`);
    await page.getByTestId("reel-file").setInputFiles({ name: "my-reel.mp4", mimeType: "video/mp4", buffer: fakeMp4 });
    await page.getByTestId("reel-file-chosen").waitFor();
    const [sw, cw] = await page.evaluate(() => [document.scrollingElement!.scrollWidth, document.scrollingElement!.clientWidth]);
    must(sw <= cw + 1, `nothing scrolls sideways at 390 (${sw} > ${cw})`);
    console.log("✓ at 390 the page fits");
  } finally {
    await browser.close();
    store?.close();
    const made = (await db.query.ladders.findMany({ where: eq(schema.ladders.userId, maya.id), columns: { id: true } })).map((l) => l.id).filter((id) => !before.has(id));
    if (made.length) await db.delete(schema.ladders).where(inArray(schema.ladders.id, made));
    await db.delete(schema.mediaVideos).where(and(eq(schema.mediaVideos.workspaceId, ws), inArray(schema.mediaVideos.userId, [maya.id, "someone-else"])));
    if (!hadKey) await db.delete(schema.aiCredentials).where(eq(schema.aiCredentials.id, keyId));
    for (const p of procs) {
      try {
        process.kill(-p.pid!);
      } catch {}
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
