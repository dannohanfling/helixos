/**
 * A stand-in for Instacart's developer platform for the Body walk. `npx tsx scripts/mock-instacart.ts 4071`, then run the app with
 * INSTACART_API_URL=http://localhost:4071 and INSTACART_API_KEY=test-instacart-key. POST /idp/v1/products/products_link with that
 * bearer key answers a shopping-list link and remembers the body; any other key is 401; an empty list is 400. `GET /__calls`
 * lists every request it was sent (method, path, the lines), so a walk can prove what went out and that nothing else did.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4071);
const calls: { method: string; path: string; body: unknown }[] = [];
let n = 0;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__calls") return json(200, { calls });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    calls.push({ method: req.method ?? "?", path: url.pathname, body });
    if (req.method !== "POST" || url.pathname !== "/idp/v1/products/products_link") return json(404, { error: "not found" });
    if ((req.headers.authorization ?? "") !== "Bearer test-instacart-key") return json(401, { error: "unauthorized" });
    const items = (body as { line_items?: unknown[] } | null)?.line_items;
    if (!Array.isArray(items) || !items.length) return json(400, { error: "line_items required" });
    return json(200, { products_link_url: `https://instacart.example/store/shopping_lists/${++n}` });
  });
}).listen(port, () => console.log(`mock-instacart on :${port}`));
