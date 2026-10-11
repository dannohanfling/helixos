/**
 * Voice pack 2 (rev 642), end to end over the HelixOS connector's own route, as Maya, each write checked in the database: a DM
 * logged with a follow-up and logged again (one DM started, one follow-up task), an ambiguous name that changes nothing, a win
 * saved without and with the client's agreement (a draft either way, the words and numbers exact), an idea added and a ladder
 * made from it (the idea moves to Creating), a call sheet read with the person's DM line, a call's action steps read and one
 * added twice (one task), another client's one-to-one never visible, Office Hours refused without confirm and then sent (on the
 * list with its time), and a team member refused where the app refuses. Runs against scripts/mock-ai.ts, as dev-server.sh sets up.
 */
import { spawn } from "node:child_process";

// The server's own secret, so the AI key sealed here opens there.
process.env.SESSION_SECRET ??= "dev-secret-dev-secret-dev-secret-123";
const base = process.argv[2] ?? "http://localhost:3000";
const aiPort = 4020;
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
  const mocks = [spawn("npx", ["tsx", "scripts/mock-ai.ts", String(aiPort)], { stdio: "ignore", detached: true })];
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const { db, schema } = await import("@/db");
    const { and, eq, like } = await import("drizzle-orm");
    const { seal } = await import("@/lib/crypto");
    const { newId } = await import("@/lib/ids");
    const { viewerFor } = await import("@/lib/auth");
    const { registerClient, issueCode, exchangeCode } = await import("@/lib/mcp/oauth");
    const { todayActivity } = await import("@/lib/queries/daily");
    const { allTools } = await import("@/lib/mcp/registry");
    await import("@/lib/mcp/tools");
    const { CLARITY_BEATS } = await import("@/lib/engine/socrates");
    const { createHash, randomBytes } = await import("node:crypto");
    const maya = (await db.query.users.findFirst({ where: eq(schema.users.email, "client@demo.helixos.app") }))!;
    const jordan = (await db.query.users.findFirst({ where: eq(schema.users.email, "client2@demo.helixos.app") }))!;
    const m = (await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, maya.id) }))!;
    const ws = m.workspaceId;
    const utcToday = new Date().toISOString().slice(0, 10);
    await db.delete(schema.aiCredentials).where(and(eq(schema.aiCredentials.workspaceId, ws), eq(schema.aiCredentials.userId, maya.id)));
    await db.insert(schema.aiCredentials).values({ id: newId(), workspaceId: ws, userId: maya.id, provider: "anthropic", keyEncrypted: seal("sk-ant-good")!, last4: "good" });

    // A connection with the five new ticks and Content's two, made the way Claude makes one.
    const client = await registerClient("Walk voice pack", [CALLBACK]);
    const v = (await viewerFor(maya.id, ws))!;
    const verifier = randomBytes(32).toString("base64url");
    const code = await issueCode({ v, clientId: client.id, redirectUri: CALLBACK, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), resource: null, scopes: ["dms", "proofs", "sales", "recordings", "office_hours", "content", "content:write"] as never });
    const pair = await exchangeCode({ code, verifier, clientId: client.id, redirectUri: CALLBACK, resource: null, expectedResource: `${base}/api/mcp` });
    must("access_token" in pair, `the code exchanges: ${JSON.stringify(pair)}`);
    const token = (pair as { access_token: string }).access_token;
    const listed = ((await (await rpc(token, "tools/list")).json()) as { result?: { tools?: { name: string }[] } }).result?.tools?.map((t) => t.name) ?? [];
    const pack = ["dm_log", "dms_list", "proof_add", "proof_list", "idea_add", "ideas_list", "callsheet_read", "action_steps_read", "action_step_to_task", "office_hours_submit", "office_hours_list"];
    for (const n of pack) must(listed.includes(n), `the connection lists ${n}`);
    must(!listed.includes("ladder_ship"), "no ship tool without Content: publish");
    must((await tool(token, "whoami")).text.includes("DMs, Proof Bank, Sales calls, Recordings, Office Hours"), "whoami names the new ticks");
    console.log(`✓ scopes: the ${pack.length} tools listed under DMs, Proof Bank, Sales calls, Recordings, Office Hours and Content; whoami names them`);

    // 1. A DM with a follow-up, then the same person again: one DM started, one point, one follow-up task.
    const before = await todayActivity(ws, maya.id, utcToday);
    let r = await tool(token, "dm_log", { person: "Zelda Quorn", where: "Instagram", note: "Interested, asked about price", follow_up: "Thursday" });
    must(!r.isError && r.text.startsWith("Added and logged Zelda Quorn: in conversation, follow-up "), `a new person is added in conversation: ${r.text}`);
    const zelda = (await db.query.contacts.findFirst({ where: and(eq(schema.contacts.userId, maya.id), eq(schema.contacts.name, "Zelda Quorn")) }))!;
    must(zelda.stage === "conversation" && zelda.platform === "Instagram" && zelda.nextFollowUpAt === r.data!.nextFollowUpAt, "the contact as said");
    r = await tool(token, "dm_log", { person: "zelda", note: "Sent the price sheet", follow_up: "tomorrow" });
    must(!r.isError && r.text.startsWith("Logged Zelda Quorn: in conversation, follow-up tomorrow"), `the same person found by first name: ${r.text}`);
    const after = await todayActivity(ws, maya.id, utcToday);
    must(after.dmsStarted === before.dmsStarted + 1, `one DM started, not two: ${before.dmsStarted} → ${after.dmsStarted}`);
    const msgs = await db.query.messages.findMany({ where: eq(schema.messages.contactId, zelda.id) });
    must(msgs.length === 2 && msgs.every((x) => x.direction === "out"), "both notes logged on the conversation");
    const pts = await db.query.pointsLedger.findMany({ where: and(eq(schema.pointsLedger.userId, maya.id), eq(schema.pointsLedger.refId, `contact:${zelda.id}`)) });
    must(pts.length === 1, `one DM-started score: ${pts.length}`);
    const fu = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.sourceRef, `contact:${zelda.id}`)) });
    const z2 = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, zelda.id) }))!;
    must(fu.length === 1 && fu[0].title === "Follow up with Zelda Quorn" && fu[0].category === "sales" && fu[0].dueDate === z2.nextFollowUpAt, `one follow-up task, moved to the new day: ${JSON.stringify(fu.map((t) => [t.title, t.dueDate]))}`);
    console.log("✓ a DM logged with a follow-up, then again: one DM started, one score, one Follow up task moved to the new day");

    // 2. An ambiguous name changes nothing. Call booked without an email or phone is refused, as in the app.
    for (const name of ["Walkby Ann", "Walkby Bea"]) await db.insert(schema.contacts).values({ id: newId(), workspaceId: ws, userId: maya.id, name, stage: "replied" });
    const count = (await db.query.contacts.findMany({ where: eq(schema.contacts.userId, maya.id) })).length;
    r = await tool(token, "dm_log", { person: "Walkby", note: "should not land", status: "Cold" });
    must(!r.isError && r.text.includes("fits 2 people, so nothing changed") && r.text.includes("1. Walkby"), `several are read back: ${r.text}`);
    must((await db.query.contacts.findMany({ where: eq(schema.contacts.userId, maya.id) })).length === count, "no one added");
    must((await db.query.contacts.findMany({ where: and(eq(schema.contacts.userId, maya.id), like(schema.contacts.name, "Walkby%")) })).every((c) => c.stage === "replied"), "no stage changed");
    r = await tool(token, "dm_log", { person: "Zelda Quorn", status: "Call booked" });
    must(r.text.includes("Call booked needs Zelda's email or phone first"), `call booked needs an identity: ${r.text}`);
    must((await db.query.contacts.findFirst({ where: eq(schema.contacts.id, zelda.id) }))!.stage === "conversation", "the stage stays");
    console.log("✓ an ambiguous name read back numbered with nothing changed; Call booked without an email or phone refused, as in the app");

    // 3. A win without, then with, the client's agreement: a draft either way; words and numbers exact.
    r = await tool(token, "proof_add", { who: "Jen Walk", result: "Booked 6 calls from one post", numbers: "$4,200 in 3 weeks", date: "2026-10-08", source: "call" });
    must(!r.isError && r.text === "Saved Jen's win to your Proof Bank, private until you approve it.", `saved: ${r.text}`);
    let p = (await db.query.proofs.findFirst({ where: eq(schema.proofs.id, String(r.data!.id)) }))!;
    must(p.status === "draft" && !p.permissionAt && p.resultAfter === "Booked 6 calls from one post ($4,200 in 3 weeks)" && p.tags.join(",") === "2026-10-08,call", `a draft, exact, tagged: ${JSON.stringify(p)}`);
    r = await tool(token, "proof_add", { who: "Ray Walk", result: "Went from 0 to 3 clients", client_agreed: true });
    p = (await db.query.proofs.findFirst({ where: eq(schema.proofs.id, String(r.data!.id)) }))!;
    must(p.status === "draft" && p.permissionAt && p.permissionBy === maya.id && p.tags.includes("permission by voice"), "with agreement: the tick recorded, still a draft");
    r = await tool(token, "proof_list", {});
    must(r.text.includes("Ray Walk: Went from 0 to 3 clients (permission given)") && r.text.includes("Jen Walk: Booked 6 calls from one post (draft)"), `the list with states: ${r.text}`);
    console.log("✓ two wins saved as drafts, words and numbers exact; the permission tick only with the client's agreement; never approved");

    // 4. An idea, then a ladder from it: the idea moves to Creating.
    r = await tool(token, "idea_add", { idea: "Why morning walks beat the gym for busy moms", notes: "My own 6am routine", format_hint: "comment ladder" });
    const ideaId = String(r.data!.id);
    must(!r.isError && (await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, ideaId) }))!.status === "idea", "the idea is on the board");
    must((await tool(token, "ideas_list", {})).text.includes("Why morning walks beat the gym for busy moms (Comment Ladder)"), "ideas_list reads it");
    r = await tool(token, "ladder_create", { idea: "morning walks" });
    must(!r.isError && (r.data!.idea as { id: string }).id === ideaId, `a ladder from the idea: ${r.text}`);
    const lad = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, String(r.data!.id)) }))!;
    must(lad.topic === "Why morning walks beat the gym for busy moms" && (lad.sourceMaterial ?? "").includes("My own 6am routine"), "the idea's title and notes are the topic and notes");
    must((await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, ideaId) }))!.status === "creating", "the idea moved to Creating");
    console.log("✓ an idea added and a ladder made from it: its title and notes used, the idea moved to Creating");

    // 5. A call sheet with a DM line.
    const qs = await db.query.socratesQuestions.findMany();
    const beats: Record<string, { questionIds: string[]; reframeIds: string[]; override: string | null; listenFor: string | null }> = {};
    for (const b of CLARITY_BEATS) {
      const q = qs.find((x) => x.userId === null && x.clarityStage === b.stage);
      beats[b.key] = { questionIds: q ? [q.id] : [], reframeIds: [], override: q ? null : `Walk line for ${b.name}`, listenFor: `Walk listen ${b.key}` };
    }
    await db.insert(schema.socratesScripts).values({ id: newId(), workspaceId: ws, userId: maya.id, name: "Walk discovery call", beats });
    r = await tool(token, "callsheet_read", { script: "walk discovery", person: "Zelda" });
    must(!r.isError && r.text.startsWith('"Walk discovery call", 7 beats.'), `the sheet by name: ${r.text.slice(0, 120)}`);
    must(r.text.includes('Zelda Quorn: last note "Sent the price sheet" · In conversation'), "the person's DM line");
    must(r.text.includes("The 30-second version:\n1. Context: ") && r.text.includes("Listen for:\n1. Walk listen C\n2. Walk listen L\n3. Walk listen A") && r.text.includes("7. Your Next Step"), "the 30-second version, then the whole sheet");
    console.log("✓ the call sheet by name: the 30-second version, three listen-fors, all seven beats, and the person's DM line");

    // 6. Action steps: Maya's own and Everyone's, never Jordan's, never Jordan's one-to-one; one added twice is one task.
    const item = (description: string, ts: string, who: { name: string; email: string } | null) => ({ description, completed: false, timestamp: ts, playbackUrl: null, assigneeName: who?.name ?? null, assigneeEmail: who?.email ?? null });
    const recId = newId();
    await db.insert(schema.recordings).values({ id: recId, workspaceId: ws, fathomRecordingId: `walk-${recId}`, title: "Walk Accelerator call", url: "https://fathom.video/calls/111", shareUrl: "https://fathom.video/share/walk111", startedAt: new Date(Date.now() - 3600_000).toISOString(), source: "sync", status: "published", audience: "accelerator_academy", actionItems: [item("Jordan sends his deck", "00:02:00", { name: jordan.name, email: jordan.email }), item("Everyone posts a win", "00:05:00", null), item("Maya records her hook video", "00:03:10", { name: maya.name, email: maya.email })] });
    await db.insert(schema.recordings).values({ id: newId(), workspaceId: ws, fathomRecordingId: `walk-1on1-${recId}`, title: "Jordan private strategy", url: "https://fathom.video/calls/222", startedAt: new Date().toISOString(), source: "sync", status: "published", audience: "members", audienceUserIds: [jordan.id], actionItems: [item("Jordan fixes pricing", "00:01:00", { name: jordan.name, email: jordan.email })] });
    r = await tool(token, "action_steps_read", {});
    must(!r.isError && r.text.startsWith('"Walk Accelerator call"') && r.text.includes("1. Maya records her hook video at 3:10") && r.text.includes("2. Everyone posts a win (everyone) at 5:00"), `own then everyone, in call order: ${r.text}`);
    must(!r.text.includes("Jordan"), "another person's step and the one-to-one never show");
    r = await tool(token, "action_steps_read", { call: "private strategy" });
    must(r.isError && r.text.includes('No call you can open matches "private strategy"'), `the one-to-one is never visible: ${r.text}`);
    const a1 = await tool(token, "action_step_to_task", { step: 1 });
    const a2 = await tool(token, "action_step_to_task", { step: 1 });
    must(!a1.isError && a1.text === 'Added to today\'s tasks: "Maya records her hook video".' && a2.text === '"Maya records her hook video" is already on your tasks.', `added once: ${a1.text} / ${a2.text}`);
    const stepTasks = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, maya.id), eq(schema.tasks.sourceRef, recId)) });
    must(stepTasks.length === 1 && stepTasks[0].source === "fathom" && (stepTasks[0].details ?? "").includes("Jump to this moment: https://fathom.video/share/walk111"), "one task, source fathom, with its moment");
    console.log("✓ action steps: own then Everyone's in call order, Jordan's and his one-to-one never shown; one step added twice is one task");

    // 7. Office Hours: refused without confirm (nothing saved), outside the next four Fridays, then sent; on the list.
    const ooh = async () => (await db.query.officeHoursRequests.findMany({ where: eq(schema.officeHoursRequests.userId, maya.id) })).length;
    const had = await ooh();
    const ask = { question: "My bot loops on the welcome flow", tried: "Rebuilt the flow twice", outcome: "A welcome flow that ends", category: v.workspace.oohCategories[0] };
    r = await tool(token, "office_hours_submit", ask);
    must(!r.isError && r.data!.sent === false && /you'll be there on Friday the \d+(st|nd|rd|th)\. Shall I send it\?/.test(r.text) && (await ooh()) === had, `the read-back, nothing saved: ${r.text}`);
    r = await tool(token, "office_hours_submit", { ...ask, friday: "2099-01-02", confirm: true });
    must(r.isError && r.text.startsWith("Pick one of the next four Fridays") && (await ooh()) === had, `a far Friday refused: ${r.text}`);
    r = await tool(token, "office_hours_submit", { ...ask, confirm: true });
    must(!r.isError && r.data!.sent === true && (await ooh()) === had + 1, `sent after the yes: ${r.text}`);
    const sent = (await db.query.officeHoursRequests.findFirst({ where: eq(schema.officeHoursRequests.id, String(r.data!.id)) }))!;
    must(sent.description === ask.question && sent.triedSelf === ask.tried && sent.goal === ask.outcome && sent.createdAt, "saved word for word, with its time");
    r = await tool(token, "office_hours_list", {});
    must(r.text.includes(`${ask.category}: ${ask.question} (pending)`) && ((r.data!.requests as { submitted: string }[])[0].submitted === sent.createdAt), `on the list with its time: ${r.text}`);
    console.log("✓ Office Hours: the read-back first with nothing saved, a far Friday refused, sent after the yes, on the list with its time");

    // 9. "Read me my scoreboard": the member hears their week; the coach hears the roster, names only.
    const sbTool = allTools().find((t) => t.name === "scoreboard_read")!;
    const heard = await sbTool.handler(v, { week: "this" });
    must(heard.text.startsWith("This week so far: ") && heard.text.includes("DMs started:"), `Maya hears her week: ${heard.text.slice(0, 120)}`);
    const coachU = (await db.query.users.findFirst({ where: eq(schema.users.email, "coach@demo.helixos.app") }))!;
    const coachV = (await viewerFor(coachU.id, ws))!;
    const roster = await sbTool.handler(coachV, {});
    must(roster.text.includes("Maya T: ") && roster.text.includes("Jordan L: ") && !/@|Torres/.test(roster.text), `the coach hears the roster, names only: ${roster.text.slice(0, 200)}`);
    console.log("✓ scoreboard_read: Maya hears this week so far; the coach hears one line per client, names only");

    // 8. A team member: refused where the app refuses; DMs stay open to them.
    const teamV = { ...v, team: { teamMemberId: "walk", ownerMembershipId: m.id, ownerName: maya.name, teamName: "Walk VA" } };
    const call = (n: string, input: Record<string, unknown>) => allTools().find((t) => t.name === n)!.handler(teamV, input);
    for (const [n, input] of [["proof_add", { result: "x x x" }], ["action_steps_read", {}], ["office_hours_submit", { ...ask, confirm: true }], ["callsheet_read", {}]] as const) {
      const out = await call(n, input).then(() => "ok", (e: Error) => e.message);
      must(out.startsWith("A team member can't"), `${n} refused to a team member: ${out}`);
    }
    must((await call("dms_list", {})).text.includes("waiting on your reply"), "a team member reads the DMs, as in the app");
    must((await ooh()) === had + 1, "nothing saved by the team member");
    console.log("✓ a team member refused on proofs, recordings, the call sheet and Office Hours; DMs open, as in the app");

    console.log("\nvoicepack walk passed");
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
