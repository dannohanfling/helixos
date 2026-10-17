/**
 * A stand-in for the eLoyalty (WalletPush) REST API for the leaderboard walk (rev 639): GET customers (paged by cursor, three
 * per page, filtered by is_active and template_id) and GET templates, behind the walk's key. /__mode?status=429 makes every
 * call answer that status until /__mode?status=200; /__calls counts calls and lists every write.
 *
 * The points outbox (H-493): POST /api/public/admin/points/add and /deduct by customer id move an in-memory balance (an add
 * counts as earned; a deduct never goes below 0 and leaves earned alone), answer { success, eventId, newBalance }, and show
 * in that customer's events with their reason. GET /api/public/admin/customers/{id} reads one customer. Any other write is 405.
 */
import { createServer } from "node:http";
import { CUSTOMERS, ELOYALTY_KEY, TEMPLATES } from "./fixtures/eloyalty";

const port = Number(process.argv[2] ?? 4080);
let forced = 200;
let calls = 0;
const writes: string[] = [];
const balances = new Map(CUSTOMERS.map((c) => [c.id, { balance: c.points_balance, earned: c.points_earned }]));
const moved: { id: string; type: string; points: number; reason: string; created_at: string }[] = [];
const now = () => new Date().toISOString();
const live = <T extends { id: string; points_balance: number; points_earned: number }>(c: T): T => ({ ...c, points_balance: balances.get(c.id)!.balance, points_earned: balances.get(c.id)!.earned });
const body = (req: import("node:http").IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
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
  const move = req.method === "POST" ? url.pathname.match(/^\/api\/public\/admin\/points\/(add|deduct)$/) : null;
  if (req.method !== "GET") writes.push(`${req.method} ${url.pathname}`);
  if (move) {
    if (req.headers.authorization !== `Bearer ${ELOYALTY_KEY}`) return json(401, { error: "invalid key" });
    if (forced !== 200) return json(forced, { error: "forced" });
    void body(req).then((b) => {
      const id = String(b.customerId ?? "");
      const points = Math.round(Number(b.points ?? 0));
      const bal = balances.get(id);
      if (!bal) return json(404, { success: false, error: "customer not found" });
      if (!(points > 0)) return json(400, { success: false, error: "points must be positive" });
      if (move[1] === "deduct" && points > bal.balance) return json(400, { success: false, error: "insufficient points" });
      if (move[1] === "add") {
        bal.balance += points;
        bal.earned += points;
      } else bal.balance -= points;
      const eventId = `ev_${moved.length + 1}`;
      moved.push({ id, type: move[1] === "add" ? "points_added" : "points_deducted", points, reason: String(b.reason ?? ""), created_at: now() });
      json(200, { success: true, eventId, newBalance: bal.balance });
    });
    return;
  }
  if (req.method !== "GET") return json(405, { error: "read-only mock" });
  calls++;
  if (req.headers.authorization !== `Bearer ${ELOYALTY_KEY}`) return json(401, { error: "invalid key" });
  if (forced !== 200) return json(forced, { error: "forced" });
  if (url.pathname === "/api/external/v1/templates") return json(200, { data: TEMPLATES });
  // The points check's history read: a customer's events, newest change made by hand in the portal for cus_001, by the API for the rest.
  const ev = url.pathname.match(/^\/api\/public\/admin\/customers\/([^/]+)\/events$/);
  if (ev) {
    const id = decodeURIComponent(ev[1]);
    if (!CUSTOMERS.some((c) => c.id === id)) return json(404, { error: "not found" });
    const mine = moved.filter((m) => m.id === id).map(({ type, points, reason, created_at }) => ({ type, points, reason, created_at, source: "api_key" }));
    return json(200, { data: [...mine.reverse(), { type: "points_added", points: 100, created_at: "2026-10-01T10:00:00Z", source: "api_key" }, ...(id === "cus_001" ? [{ type: "points_adjusted", points: 50, created_at: "2026-10-05T09:00:00Z", source: "portal", created_by: { name: "Walk Staffer" } }] : [])] });
  }
  const one = url.pathname.match(/^\/api\/public\/admin\/customers\/([^/]+)$/);
  if (one) {
    const c = CUSTOMERS.find((x) => x.id === decodeURIComponent(one[1]));
    return c ? json(200, { data: live(c) }) : json(404, { error: "not found" });
  }
  if (url.pathname === "/api/external/v1/customers") {
    const tpl = url.searchParams.get("template_id");
    const active = url.searchParams.get("is_active") === "true";
    const all = CUSTOMERS.filter((c) => (!tpl || c.template_id === tpl) && (!active || c.is_active));
    const limit = Math.min(3, Number(url.searchParams.get("limit") ?? 3));
    const from = Number(url.searchParams.get("cursor") ?? 0);
    const data = all.slice(from, from + limit).map(live);
    const next = from + limit < all.length ? String(from + limit) : null;
    return json(200, { data, pagination: { next_cursor: next, has_more: Boolean(next) } });
  }
  return json(404, { error: "not found" });
}).listen(port, () => console.log(`mock eLoyalty on http://localhost:${port}`));
