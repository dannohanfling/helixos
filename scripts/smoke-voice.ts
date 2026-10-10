/**
 * Voice to Ship (rev 638), end to end over the HelixOS connector's own route, as Maya: the scopes (write without publish lists
 * no ship tool; whoami says what is allowed), a ladder written (never given the coach's library), rung 3 changed by
 * instruction, the headline swapped for alternate 1, a photo found by words, the graphic made, the preview read back by
 * account name, a Ship refused without confirm, with an old preview after an edit, and twice; then shipped with the readback
 * word for word, the two posts in the Planner with the graphic and the rungs handed to the rungs-only webhook. Runs against
 * scripts/mock-ai.ts, mock-blob.ts and mock-ghl.ts (GoHighLevel and the Community Loyalty webhook), as dev-server.sh sets up.
 */
import { spawn } from "node:child_process";

// The server's own secret, so a value sealed here (the GoHighLevel token, the webhook, the AI key) opens there.
process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
const blobPort = 4050;
const ghlPort = 4010;
const RUNGS_HOOK = `http://localhost:${ghlPort}/api/iwh/ru0123456789abcdef0123456789abcd`;
const CALLBACK = "http://localhost:4090/cb";
const must = (ok: unknown, msg: string) => {
  if (!ok) throw new Error(msg);
};
let rpcId = 0;
const rpc = (token: string, method: string, params: unknown = {}) =>
  fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
type Called = { text: string; data: Record<string, unknown> | null; isError: boolean };
async function tool(token: string, name: string, args: Record<string, unknown> = {}): Promise<Called> {
  const res = (await (await rpc(token, "tools/call", { name, arguments: args })).json()) as { result?: { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  if (res.error) return { text: res.error.message, data: null, isError: true };
  const full = res.result?.content?.[0]?.text ?? "";
  const cut = full.indexOf("\n\n{");
  return { text: cut < 0 ? full : full.slice(0, cut), data: cut < 0 ? null : (JSON.parse(full.slice(cut + 2)) as Record<string, unknown>), isError: Boolean(res.result?.isError) };
}

async function main() {
  const mocks = [
    spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true }),
    spawn("npx", ["tsx", "scripts/mock-blob.ts", String(blobPort)], { stdio: "ignore", detached: true }),
    spawn("npx", ["tsx", "scripts/mock-ghl.ts", String(ghlPort)], { stdio: "ignore", detached: true }),
  ];
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { viewerFor } = await import("@/lib/auth");
    const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
    const { upsertConnection } = await import("@/lib/ghl");
    const { createHash, randomBytes } = await import("node:crypto");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = m.workspaceId;

    // Maya's setup, as Settings and the coach would leave it: her AI key, GoHighLevel connected, the rungs webhook, no keyword.
    await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, maya.id)));
    await db.insert(schema.aiCredentials).values({ id: newId(), workspaceId: ws, userId: maya.id, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });
    const ghlRow = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, ws), eq(schema.integrations.provider, "gohighlevel")) });
    if (ghlRow) await db.update(schema.integrations).set({ enabled: true, config: { ...ghlRow.config, apiUrl: `http://localhost:${ghlPort}` }, lastError: null }).where(eq(schema.integrations.id, ghlRow.id));
    else await db.insert(schema.integrations).values({ id: newId(), workspaceId: ws, provider: "gohighlevel", enabled: true, config: { apiUrl: `http://localhost:${ghlPort}` } });
    const up = await upsertConnection({ workspaceId: ws, userId: maya.id, locationId: "loc_maya", ghlUserId: "JD8kLxeYM3FqbWLQXC4p", manualToken: "pit-loc_maya" });
    must(up.ok, `GoHighLevel connects: ${!up.ok ? up.error : ""}`);
    const conn = (await db.query.socialConnections.findFirst({ where: eq(schema.socialConnections.userId, maya.id) }))!;
    must(conn.mapping.fb_page && conn.mapping.instagram, "the Page and Instagram are mapped");
    const pageName = conn.accounts.find((a) => a.id === conn.mapping.fb_page)!.name;
    const igName = conn.accounts.find((a) => a.id === conn.mapping.instagram)!.name;
    await db.update(schema.memberships).set({ clRungsWebhookUrl: seal(RUNGS_HOOK), clUserNs: "f52594u50757435" }).where(eq(schema.memberships.id, m.id));
    await db.update(schema.ladderProfiles).set({ keywords: [] }).where(and(eq(schema.ladderProfiles.workspaceId, ws), eq(schema.ladderProfiles.userId, maya.id)));
    await db.update(schema.dripHandoffs).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(eq(schema.dripHandoffs.userId, maya.id));
    await db.insert(schema.deckImages).values({ id: newId(), workspaceId: ws, userId: maya.id, kind: "photo", blobKey: "walk/gym.jpg", blobUrl: `http://localhost:${blobPort}/walk/gym.jpg`, mime: "image/jpeg", width: 1080, height: 1350, caption: "Me at the gym before a client call", source: "upload" });

    // A connection made the way Claude makes one: registered, consented with these scopes, the code exchanged.
    const client = await registerClient("Walk voice", [CALLBACK]);
    const v = (await viewerFor(maya.id, ws))!;
    const connect = async (scopes: string[]) => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: challenge, resource: null, scopes: scopes as never });
      const pair = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` });
      must("access_token" in pair, `the code exchanges: ${JSON.stringify(pair)}`);
      return (pair as { access_token: string }).access_token;
    };

    // Write without publish: the ship tools aren't there; whoami says what is allowed.
    const writer = await connect(["content", "content:write"]);
    const listed = ((await (await rpc(writer, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.map((t) => t.name) ?? [];
    for (const n of ["ladders_list", "ladder_read", "images_find", "ladder_create", "ladder_update", "ladder_make_graphic"]) must(listed.includes(n), `content and content:write list ${n}`);
    must(!listed.includes("ladder_ship") && !listed.includes("ladder_ship_preview"), "no ship tool without Content: publish");
    must((await tool(writer, "whoami")).text.includes("Allowed: Content, Content: write."), "whoami names what this connection may do");
    console.log("✓ scopes: Content and Content: write list the writing tools and no ship tool; whoami says what is allowed");

    // Write a ladder: the same writer, never the coach's library for a client.
    const created = await tool(writer, "ladder_create", { topic: "Three calls from one post" });
    must(!created.isError && created.text.startsWith('Ladder ready: "THE FIRST CLIENT CAME FROM ONE CONVERSATION", 5 rungs, checks passed'), `the one-line summary leads: ${created.text}`);
    must(created.text.includes("Headline and alternates:\n1. THE FIRST CLIENT CAME FROM ONE CONVERSATION\n2. THREE CALLS BOOKED FROM ONE SIMPLE POST"), `the headlines are numbered: ${created.text}`);
    must(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(created.text.split("Open it:")[0]), "no id in the spoken part");
    const last = ((await (await fetch(`http://localhost:${aiPort}/__last`)).json()) as { user: string }).user;
    must(!last.includes("FROM YOUR TEACHING LIBRARY"), "a client's ladder is never given the coach's library");
    const ladderId = String(created.data?.id);
    console.log("✓ ladder_create: one sentence first, numbered headlines, no id spoken, no library for a client");

    // Change rung 3 by instruction, swap the headline for alternate 1, find a photo, make the graphic.
    const rung = await tool(writer, "ladder_update", { ladder: "three calls", part: "rung", rung: 3, instruction: "make it shorter" });
    must(!rung.isError && rung.text.startsWith("Rung 3 changed, checks passed"), `rung 3 changed by instruction: ${rung.text}`);
    let row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))!;
    must(row.rungs[2].body.startsWith("Mock AI draft"), "the writer's rewrite is saved to rung 3 only");
    const swap = await tool(writer, "ladder_update", { ladder: ladderId, part: "headline", use_alternate: 1 });
    row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))!;
    must(!swap.isError && row.headline.startsWith("THREE CALLS BOOKED") && row.altHeadlines[0].startsWith("THE FIRST CLIENT"), `alternate 1 becomes the headline, the old one an alternate: ${swap.text}`);
    const found = await tool(writer, "images_find", { words: "the gym one" });
    must(found.text.startsWith("1 match, the first suggested:\n1. Me at the gym before a client call"), `the photo is found by words: ${found.text}`);
    const made = await tool(writer, "ladder_make_graphic", { ladder: ladderId, photo: "none" });
    must(!made.isError && made.text.startsWith("Made the graphic"), `the graphic is made: ${made.text}`);
    console.log("✓ ladder_update by instruction and by alternate; images_find by words; the graphic made");

    // Publish: the preview by account name and a token; refusals without confirm, after an edit, and twice.
    const publisher = await connect(["content", "content:write", "content:publish"]);
    let preview = await tool(publisher, "ladder_ship_preview", { ladder: ladderId });
    must(!preview.isError && preview.data?.canShip === true, `the preview says it can ship: ${preview.text}`);
    must(preview.text.startsWith(`Shipping "Three calls from one post" will post to Facebook Page "${pageName}" and Instagram "${igName}".`), `the accounts by name: ${preview.text}`);
    must(preview.text.includes("Headline on the graphic: THREE CALLS BOOKED FROM ONE SIMPLE POST") && preview.text.includes("Rungs: 5, the first about 5 minutes after both posts are live"), `what will post: ${preview.text}`);
    const token0 = String(preview.data?.preview_token);
    must((await tool(publisher, "ladder_ship", { ladder: ladderId, preview_token: token0, confirm: false })).text.startsWith("Not shipped. Read the preview back"), "no ship without confirm");
    await tool(writer, "ladder_update", { ladder: ladderId, part: "body", text: "Mock hook, edited.\n\nThe whole plan is in the comments. Read them in order. 👇\n\nWhat would you try first?" });
    const stale = await tool(publisher, "ladder_ship", { ladder: ladderId, preview_token: token0, confirm: true });
    must(stale.text === "Not shipped. The ladder changed after the preview. Preview again and read back what will post now.", `an edit voids the preview: ${stale.text}`);
    must((await tool(publisher, "ladder_ship", { ladder: ladderId, preview_token: "forged.token", confirm: true })).text.includes("isn't one HelixOS gave"), "a forged token is refused");
    must(!(await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))!.shippedAt, "nothing shipped yet");
    console.log("✓ ladder_ship_preview by account name; refused without confirm, after an edit and with a forged token");

    // The yes, then the Ship: the readback word for word, the posts and the rungs where the button would put them.
    preview = await tool(publisher, "ladder_ship_preview", { ladder: ladderId });
    const shipped = await tool(publisher, "ladder_ship", { ladder: ladderId, preview_token: String(preview.data?.preview_token), confirm: true });
    must(!shipped.isError && shipped.text === "Facebook: posted · Instagram: posted · Rungs queued: 5, first one in about 5 minutes", `the readback: ${shipped.text}`);
    row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, ladderId) }))!;
    must(row.shippedAt && row.graphicPublicToken, "marked shipped, the graphic at its public address");
    const posts = ((await (await fetch(`http://localhost:${ghlPort}/__posts`, { headers: { Authorization: "Bearer pit-loc_maya", Version: "2021-07-28" } })).json()) as { posts: { media?: { url: string }[] }[] }).posts;
    must(posts.filter((p) => p.media?.[0]?.url?.endsWith(`/api/graphics/${row.graphicPublicToken}.png`)).length === 2, "two posts in the Planner with the graphic");
    const drips = ((await (await fetch(`http://localhost:${ghlPort}/__drips`)).json()) as { drips: { path: string; body: { rungs?: string[] } }[] }).drips;
    must(drips.some((d) => d.path.endsWith("ru0123456789abcdef0123456789abcd") && d.body.rungs?.length === 5), "the five rungs handed to the rungs-only webhook");
    const again = await tool(publisher, "ladder_ship", { ladder: ladderId, preview_token: String(preview.data?.preview_token), confirm: true });
    must(again.text.startsWith("Not shipped: this ladder has already shipped"), `no second ship: ${again.text}`);
    const late = await tool(writer, "ladder_update", { ladder: ladderId, part: "rung", rung: 1, text: "Too late" });
    must(late.isError && late.text.includes("has shipped"), "a shipped ladder isn't changed from the connector");
    console.log("✓ ladder_ship after the yes: the readback word for word, both posts with the graphic, five rungs handed; no second ship, no edit after");
    console.log("\nvoice walk passed");
  } finally {
    for (const p of mocks) {
      try {
        process.kill(-p.pid!);
      } catch {}
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
