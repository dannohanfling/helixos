/**
 * A stand-in for the Airtable REST API for the import walk. `npx tsx scripts/mock-airtable.ts 4070`, then run the app with
 * AIRTABLE_API_URL=http://localhost:4070. It serves the synthetic bases in scripts/fixtures/airtable-client.ts, one token per base
 * as Danno set them up (27 Sep): `pat-source-good` reads the source base, `pat-fallback-good` the fallback; any other token is 401,
 * a good token on the other base is 403; `pat-humanos-good` reads the synthetic HumanOS base of scripts/fixtures/airtable-humanos.ts, and `pat-omni-good` the Omnichannel base of scripts/fixtures/airtable-omni.ts (`fields[]` honoured). Only GET answers. `POST /__edit` renames the first task, so a walk can change the base
 * between a dry run and Approve; `GET /__methods` lists every method and path it was sent, so a walk can prove the import only read,
 * and never asked for the people tables' rows.
 */
import { createServer } from "node:http";
import { V1_BASE, V1_TABLES, V2_BASE, V2_TABLES, type FixtureTable } from "./fixtures/airtable-client";
import { HUMANOS_BASE, HUMANOS_TABLES, HUMANOS_TOKEN } from "./fixtures/airtable-humanos";
import { OMNI_BASE, OMNI_TABLES, OMNI_TOKEN } from "./fixtures/airtable-omni";
import { TESTIMONIALS_BASE, TESTIMONIALS_TABLES, TESTIMONIALS_TOKEN } from "./fixtures/airtable-testimonials";

const port = Number(process.argv[2] ?? 4070);
const bases: Record<string, { token: string; tables: FixtureTable[] }> = {
  [V2_BASE]: { token: "pat-source-good", tables: structuredClone(V2_TABLES) },
  [V1_BASE]: { token: "pat-fallback-good", tables: structuredClone(V1_TABLES) },
  // Body's HumanOS history (rev 237 phase 7): a third base, its own token.
  [HUMANOS_BASE]: { token: HUMANOS_TOKEN, tables: structuredClone(HUMANOS_TABLES) },
  // The coach's backfill (rev 441): the Omnichannel base, its own token.
  [OMNI_BASE]: { token: OMNI_TOKEN, tables: structuredClone(OMNI_TABLES) },
  [TESTIMONIALS_BASE]: { token: TESTIMONIALS_TOKEN, tables: structuredClone(TESTIMONIALS_TABLES) },
};
const methods: string[] = [];
const paths: string[] = [];

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__methods") return json(200, { methods, paths });
  if (url.pathname === "/__edit" && req.method === "POST") {
    const tasks = bases[V2_BASE].tables.find((t) => t.name.includes("TasksOS"))!;
    tasks.records[0].fields["📌 Tasks"] = `${tasks.records[0].fields["📌 Tasks"]} (edited)`;
    return json(200, { ok: true });
  }
  methods.push(req.method ?? "?");
  paths.push(`${url.pathname}${url.searchParams.has("fields[]") ? `?fields=${url.searchParams.getAll("fields[]").join(",")}` : ""}`);
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
  if (meta) return json(200, { tables: base.tables.map((t) => ({ id: t.id, name: t.name, ...(t.fields ? { fields: t.fields } : {}) })) });
  const table = base.tables.find((t) => t.id === decodeURIComponent(data![2]));
  if (!table) return json(404, { error: { type: "TABLE_NOT_FOUND" } });
  // Paged two at a time, so the walk proves the reader follows offset to the end.
  const from = Number(url.searchParams.get("offset") ?? 0);
  // Asked for some fields only (by id, as the backfill asks for the members' emails): only those come back.
  const only = url.searchParams.getAll("fields[]");
  const page = table.records.slice(from, from + 2).map((r) => (only.length ? { ...r, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => only.includes(k))) } : r));
  return json(200, from + 2 < table.records.length ? { records: page, offset: String(from + 2) } : { records: page });
}).listen(port, () => console.log(`mock-airtable on :${port}`));
