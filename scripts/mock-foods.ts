/**
 * A stand-in for USDA FoodData Central and Open Food Facts for the Body walk. `npx tsx scripts/mock-foods.ts 4073`, then run the
 * app with USDA_API_URL=http://localhost:4073/fdc/v1, USDA_API_KEY=test-usda-key and OFF_API_URL=http://localhost:4073/off/api/v2.
 * GET /fdc/v1/foods/search?query=&api_key= answers the foods below whose words match (403 on another key); GET
 * /off/api/v2/product/<code>.json answers the product with that code, or status 0. The walk and the unit test read the same records from scripts/fixtures/foods.ts
 * to compute what should land. `GET /__calls` lists every request, so the walk can prove the key went only to USDA and never in a path it logs.
 */
import { createServer } from "node:http";
import { records } from "./fixtures/foods";

const port = Number(process.argv[2] ?? 4073);
const calls: { method: string; path: string }[] = [];
const KEY = "test-usda-key";

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  calls.push({ method: req.method ?? "?", path: url.pathname });
  if (url.pathname === "/__calls") return json(200, { calls });
  if (url.pathname === "/__records") return json(200, records);
  if (url.pathname === "/fdc/v1/foods/search") {
    if (url.searchParams.get("api_key") !== KEY) return json(403, { error: { code: "API_KEY_INVALID" } });
    const words = (url.searchParams.get("query") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const foods = records.usda.filter((f) => words.every((w) => f.description.toLowerCase().includes(w)));
    return json(200, { totalHits: foods.length, foods });
  }
  let m: RegExpMatchArray | null;
  if ((m = url.pathname.match(/^\/off\/api\/v2\/product\/(\d+)\.json$/))) {
    const product = records.off.find((p) => p.code === m![1]);
    return json(200, product ? { code: m[1], status: 1, status_verbose: "product found", product } : { code: m[1], status: 0, status_verbose: "product not found" });
  }
  return json(404, { error: "not found" });
}).listen(port, () => console.log(`mock-foods on :${port}`));
