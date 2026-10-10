/**
 * A stand-in for the eLoyalty (WalletPush) REST API for the leaderboard walk (rev 639): GET customers (paged by cursor, three
 * per page, filtered by is_active and template_id) and GET templates, behind the walk's key. /__mode?status=429 makes every
 * call answer that status until /__mode?status=200; /__calls counts calls. It never accepts a write: anything else is 405.
 */
import { createServer } from "node:http";
import { CUSTOMERS, ELOYALTY_KEY, TEMPLATES } from "./fixtures/eloyalty";

const port = Number(process.argv[2] ?? 4080);
let forced = 200;
let calls = 0;
const writes: string[] = [];
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__mode") {
    forced = Number(url.searchParams.get("status") ?? 200);
    return json(200, { forced });
  }
  if (url.pathname === "/__calls") return json(200, { calls, writes });
  if (req.method !== "GET") {
    writes.push(`${req.method} ${url.pathname}`);
    return json(405, { error: "read-only mock" });
  }
  calls++;
  if (req.headers.authorization !== `Bearer ${ELOYALTY_KEY}`) return json(401, { error: "invalid key" });
  if (forced !== 200) return json(forced, { error: "forced" });
  if (url.pathname === "/api/external/v1/templates") return json(200, { data: TEMPLATES });
  if (url.pathname === "/api/external/v1/customers") {
    const tpl = url.searchParams.get("template_id");
    const active = url.searchParams.get("is_active") === "true";
    const all = CUSTOMERS.filter((c) => (!tpl || c.template_id === tpl) && (!active || c.is_active));
    const limit = Math.min(3, Number(url.searchParams.get("limit") ?? 3));
    const from = Number(url.searchParams.get("cursor") ?? 0);
    const data = all.slice(from, from + limit);
    const next = from + limit < all.length ? String(from + limit) : null;
    return json(200, { data, pagination: { next_cursor: next, has_more: Boolean(next) } });
  }
  return json(404, { error: "not found" });
}).listen(port, () => console.log(`mock eLoyalty on http://localhost:${port}`));
