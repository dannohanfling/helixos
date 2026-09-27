/**
 * A stand-in for the Airtable REST API for the import walk. `npx tsx scripts/mock-airtable.ts 4070`, then run the app with
 * AIRTABLE_API_URL=http://localhost:4070. It serves the synthetic bases in scripts/fixtures/airtable-client.ts, one token per base
 * as Danno set them up (27 Sep): `pat-source-good` reads the source base, `pat-fallback-good` the fallback; any other token is 401,
 * a good token on the other base is 403. Only GET answers. `POST /__edit` renames the first task, so a walk can change the base
 * between a dry run and Approve; `GET /__methods` lists every method it was sent, so a walk can prove the import only read.
 */
import { createServer } from "node:http";
import { V1_BASE, V1_TABLES, V2_BASE, V2_TABLES, type FixtureTable } from "./fixtures/airtable-client";

const port = Number(process.argv[2] ?? 4070);
const bases: Record<string, { token: string; tables: FixtureTable[] }> = {
  [V2_BASE]: { token: "pat-source-good", tables: structuredClone(V2_TABLES) },
  [V1_BASE]: { token: "pat-fallback-good", tables: structuredClone(V1_TABLES) },
};
const methods: string[] = [];

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__methods") return json(200, { methods });
  if (url.pathname === "/__edit" && req.method === "POST") {
    const tasks = bases[V2_BASE].tables.find((t) => t.name.includes("TasksOS"))!;
    tasks.records[0].fields["📌 Tasks"] = `${tasks.records[0].fields["📌 Tasks"]} (edited)`;
    return json(200, { ok: true });
  }
  methods.push(req.method ?? "?");
  if (req.method !== "GET") return json(405, { error: { type: "METHOD_NOT_ALLOWED" } });
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const known = Object.values(bases).some((b) => b.token === token);
  if (!known) return json(401, { error: { type: "AUTHENTICATION_REQUIRED" } });
  const meta = url.pathname.match(/^\/v0\/meta\/bases\/([^/]+)\/tables$/);
  const data = url.pathname.match(/^\/v0\/([^/]+)\/([^/]+)$/);
  const baseId = decodeURIComponent((meta ?? data)?.[1] ?? "");
  const base = bases[baseId];
  if (!base) return json(404, { error: { type: "NOT_FOUND" } });
  if (base.token !== token) return json(403, { error: { type: "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND" } });
  if (meta) return json(200, { tables: base.tables.map((t) => ({ id: t.id, name: t.name })) });
  const table = base.tables.find((t) => t.id === decodeURIComponent(data![2]));
  if (!table) return json(404, { error: { type: "TABLE_NOT_FOUND" } });
  // Paged two at a time, so the walk proves the reader follows offset to the end.
  const from = Number(url.searchParams.get("offset") ?? 0);
  const page = table.records.slice(from, from + 2);
  return json(200, from + 2 < table.records.length ? { records: page, offset: String(from + 2) } : { records: page });
}).listen(port, () => console.log(`mock-airtable on :${port}`));
