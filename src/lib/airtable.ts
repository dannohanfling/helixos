/**
 * Reading a client's Airtable base for the import (handoff 27 Sep), GET only. The token arrives with the request that uses it and
 * goes nowhere else: never stored, never logged, never put in a message (an Airtable error is quoted without it). The base's
 * tables are found by name through the metadata API, then only the Phase 1 tables are read, paged. AIRTABLE_API_URL points the
 * walk at scripts/mock-airtable.ts; production uses api.airtable.com.
 */
import { COUNTED, tableKey, type AirtableRecord, type ImportSource, type SourceTable } from "@/lib/engine/airtable-import";

const API = () => process.env.AIRTABLE_API_URL || "https://api.airtable.com";

/** The tables the import reads, by key: v2 Phase 1, and the one v1 table the review rows need. */
export const V2_TABLES = ["vision", "offersos", "methodologies", "buyer readiness", "tasksos", "groups", "lead magnet"];
export const V1_TABLES = ["value ladder buyer readiness"];

type Which = "source" | "fallback";
type Problem = "unreachable" | "token" | "access" | "missing" | "busy" | "other" | "base_id" | "no_token";
/** A failed read, as a code: the page says our own sentence for it, never Airtable's reply, and never the token. */
export class AirtableError extends Error {
  constructor(
    readonly problem: Problem,
    readonly which: Which,
  ) {
    super(`airtable ${problem} (${which})`);
  }
}
const SAYS: Record<Problem, string> = {
  unreachable: "Couldn't reach Airtable. Try again in a minute.",
  token: "Airtable didn't accept that token. Check it and paste it again.",
  access: "That token can't read this base. It needs data.records:read and schema.bases:read, with this base added to it.",
  missing: "Airtable has no base by that id for this token.",
  busy: "Airtable asked us to slow down. Wait 30 seconds and run it again.",
  other: "Airtable couldn't answer just now. Nothing was imported; try again in a minute.",
  base_id: "The base id starts with app and is 17 characters long.",
  no_token: "Paste this base's token.",
};
/** The sentence for the page: which base, and what to do next. */
export const airtableProblem = (e: AirtableError): string => `${e.which === "source" ? "Source base" : "Fallback base"}: ${SAYS[e.problem]}`;

async function get(token: string, which: Which, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API()}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new AirtableError("unreachable", which);
  }
  if (res.status === 401) throw new AirtableError("token", which);
  if (res.status === 403) throw new AirtableError("access", which);
  if (res.status === 404) throw new AirtableError("missing", which);
  if (res.status === 429) throw new AirtableError("busy", which);
  if (!res.ok) throw new AirtableError("other", which);
  return res.json();
}

/** The base's tables by name, from the metadata API. */
async function tables(token: string, which: Which, baseId: string): Promise<{ id: string; name: string }[]> {
  const body = (await get(token, which, `/v0/meta/bases/${encodeURIComponent(baseId)}/tables`)) as { tables?: { id: string; name: string }[] };
  return body.tables ?? [];
}

/** Every row of one table, paged 100 at a time; with `fieldIds`, only those fields of each row, keyed by field id. */
async function rows(token: string, which: Which, baseId: string, tableId: string, fieldIds: string[] = []): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ pageSize: "100" });
    for (const f of fieldIds) q.append("fields[]", f);
    if (fieldIds.length) q.set("returnFieldsByFieldId", "true");
    if (offset) q.set("offset", offset);
    const body = (await get(token, which, `/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?${q}`)) as { records?: AirtableRecord[]; offset?: string };
    out.push(...(body.records ?? []));
    offset = body.offset;
  } while (offset);
  return out;
}

async function read(token: string, which: Which, baseId: string, wanted: string[], counted: string[] = []): Promise<{ found: Record<string, SourceTable | undefined>; missing: string[]; names: Record<string, string> }> {
  const all = await tables(token, which, baseId);
  const names = Object.fromEntries(all.map((t) => [tableKey(t.name), t.name.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim()]));
  const found: Record<string, SourceTable | undefined> = {};
  const missing: string[] = [];
  for (const key of [...wanted, ...counted]) {
    const t = all.find((x) => tableKey(x.name) === key);
    if (!t) {
      if (wanted.includes(key)) missing.push(key);
      continue;
    }
    found[key] = { name: t.name.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim(), records: await rows(token, which, baseId, t.id) };
  }
  return { found, missing, names };
}

const BASE_ID = /^app[A-Za-z0-9]{14}$/;
export type BaseAccess = { baseId: string; token: string };
/**
 * The client's base, and the older one it was migrated from when given, each with its own read-only token (27 Sep: Danno made one
 * per base), read for Phase 1.
 */
export async function readSource(source: BaseAccess, fallback: BaseAccess | null): Promise<{ source: ImportSource; missing: string[] }> {
  if (!BASE_ID.test(source.baseId.trim())) throw new AirtableError("base_id", "source");
  if (!source.token.trim()) throw new AirtableError("no_token", "source");
  if (fallback && !BASE_ID.test(fallback.baseId.trim())) throw new AirtableError("base_id", "fallback");
  if (fallback && !fallback.token.trim()) throw new AirtableError("no_token", "fallback");
  // The Phase 1 tables, and the other tables of hers read for their count only (never the people tables).
  const v2 = await read(source.token.trim(), "source", source.baseId.trim(), V2_TABLES, COUNTED);
  const v1 = fallback ? await read(fallback.token.trim(), "fallback", fallback.baseId.trim(), V1_TABLES) : { found: {}, missing: [] };
  return { source: { v2: v2.found, v1: v1.found, names: v2.names }, missing: [...v2.missing, ...v1.missing.map((m) => `${m} (fallback base)`)] };
}

/**
 * A few of a base's tables by key, for Body's HumanOS history (rev 237 phase 7): the same GET-only reader, one token, the rows of
 * the tables asked for and nothing else of the base.
 */
export async function readTables(access: BaseAccess, wanted: string[]): Promise<{ found: Record<string, SourceTable | undefined>; missing: string[] }> {
  if (!BASE_ID.test(access.baseId.trim())) throw new AirtableError("base_id", "source");
  if (!access.token.trim()) throw new AirtableError("no_token", "source");
  const r = await read(access.token.trim(), "source", access.baseId.trim(), wanted);
  return { found: r.found, missing: r.missing };
}

/**
 * One field of one table, by their ids, as record id → value (rev 441's backfill: the members' emails out of the people table,
 * and nothing else of it is asked for).
 */
export async function readOneField(access: BaseAccess, tableId: string, fieldId: string): Promise<Map<string, string>> {
  if (!BASE_ID.test(access.baseId.trim())) throw new AirtableError("base_id", "source");
  if (!access.token.trim()) throw new AirtableError("no_token", "source");
  const all = await rows(access.token.trim(), "source", access.baseId.trim(), tableId, [fieldId]);
  return new Map(all.flatMap((r) => (typeof r.fields[fieldId] === "string" ? [[r.id, r.fields[fieldId] as string] as const] : [])));
}

/** A table's fields as the metadata API lists them: the primary field first; a link field names the table it links to. */
export type AirtableField = { id: string; name: string; type?: string; options?: { linkedTableId?: string } };
export async function readTableFields(access: BaseAccess, tableId: string): Promise<AirtableField[]> {
  if (!BASE_ID.test(access.baseId.trim())) throw new AirtableError("base_id", "source");
  if (!access.token.trim()) throw new AirtableError("no_token", "source");
  const body = (await get(access.token.trim(), "source", `/v0/meta/bases/${encodeURIComponent(access.baseId.trim())}/tables`)) as { tables?: { id: string; fields?: AirtableField[] }[] };
  const t = (body.tables ?? []).find((x) => x.id === tableId);
  if (!t) throw new AirtableError("missing", "source");
  return t.fields ?? [];
}
/** The rows of one table, the named fields only, keyed by field id. */
export async function readFields(access: BaseAccess, tableId: string, fieldIds: string[]): Promise<AirtableRecord[]> {
  if (!BASE_ID.test(access.baseId.trim())) throw new AirtableError("base_id", "source");
  if (!access.token.trim()) throw new AirtableError("no_token", "source");
  return rows(access.token.trim(), "source", access.baseId.trim(), tableId, fieldIds);
}
