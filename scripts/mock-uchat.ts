/**
 * A stand-in for a client's Community Loyalty (uChat) workspace API for the botfields walk. `npx tsx scripts/mock-uchat.ts 4060`,
 * then run the app with UCHAT_BASE_URL=http://localhost:4060. Holds a bot field store the walk can seed with what the client and
 * the agent wrote (calendar_id, appointment_id, booked_time), records every set-bot-fields-by-name request so the walk can read
 * exactly which names arrived, and refuses anything without a Bearer token. The request and response shapes are the published
 * UChat OpenAPI document's (code-addendum-uchat-spec.md): body `{ data: [{ name, value }] }`, 200 `{ status: "ok" }`, 400
 * `{ message }`. `POST /__skip {name}` makes the mock accept a push and silently not write that one field, so a walk can prove
 * a 200 is not a match.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4060);
let fields: Record<string, string> = {};
const requests: { fields: { name: string; value: string }[]; token: string }[] = [];
let skipped: string | null = null;

const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const read = (req: import("node:http").IncomingMessage) => new Promise<string>((resolve) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => resolve(b));
});

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/__reset") { fields = {}; requests.length = 0; skipped = null; return json(res, 200, { ok: true }); }
  // A skipped field is one the bot never wrote: it drops out of the store too, as an unknown name would never be in it.
  if (url.pathname === "/__skip" && req.method === "POST") { skipped = (JSON.parse((await read(req)) || "{}") as { name?: string }).name ?? null; if (skipped) delete fields[skipped]; return json(res, 200, { ok: true, skipped }); }
  if (url.pathname === "/__seed" && req.method === "POST") { Object.assign(fields, JSON.parse(await read(req))); return json(res, 200, { ok: true, fields }); }
  if (url.pathname === "/__requests") return json(res, 200, requests);
  if (url.pathname === "/__fields") return json(res, 200, fields);
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 12) return json(res, 401, { status: "error", message: "Unauthenticated." });
  if (url.pathname === "/flow/bot-fields" && req.method === "GET") return json(res, 200, { status: "ok", data: Object.entries(fields).map(([name, value]) => ({ name, value })) });
  if (url.pathname === "/flow/set-bot-fields-by-name" && req.method === "PUT") {
    const body = JSON.parse((await read(req)) || "{}") as { data?: { name: string; value: string }[] };
    if (!Array.isArray(body.data) || !body.data.length) return json(res, 400, { message: "The data field is required." });
    if (body.data.length > 20) return json(res, 400, { message: "The data may not have more than 20 items." });
    if (body.data.some((f) => typeof f.value !== "string" || typeof f.name !== "string")) return json(res, 400, { message: "The data.*.value must be a string." });
    requests.push({ fields: body.data, token: auth.slice(7) });
    for (const f of body.data) if (f.name !== skipped) fields[f.name] = f.value;
    return json(res, 200, { status: "ok" });
  }
  json(res, 404, { status: "error", message: `no route ${req.method} ${url.pathname}` });
}).listen(port, () => console.log(`mock-uchat on :${port}`));
