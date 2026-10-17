/**
 * The points check (H-102, H-112), the pure parts: a client's Community Loyalty bot-user export read for its pass fields, the
 * same people found among eLoyalty's customers (by customer id, then pass serial, then email, all in memory), each pair
 * compared, and one snapshot that carries "First L." and numbers only. eLoyalty is the system of record (H-107), so the
 * suggested number is its balance; a hand change in the portal, when the events say so, is the reason. Nothing here writes.
 */
import { displayName, isPlaceholderName, textIsClean } from "@/lib/engine/leaderboard";

export type Customer = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = str(v).replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** One eLoyalty customer as the check holds it in memory: the match keys stay here and never reach the snapshot. */
export type PassHolder = { id: string; serial: string; email: string; name: string; balance: number; earned: number; templateId: string; placeholder: boolean };

export function passHolders(customers: readonly Customer[]): PassHolder[] {
  const out: PassHolder[] = [];
  for (const c of customers) {
    const id = str(c.id);
    if (!id) continue;
    out.push({
      id,
      serial: str(c.pass_serial_number) || str(c.serial),
      email: str(c.email).toLowerCase(),
      name: displayName(c.first_name, c.last_name) ?? "Member",
      balance: num(c.points_balance) ?? 0,
      earned: num(c.points_earned) ?? 0,
      templateId: str(c.template_id),
      placeholder: isPlaceholderName(c.first_name, c.last_name),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The Community Loyalty export (H-105, H-107): bot users with a pass serial, their eLoyalty customer id and CL's copy of points.

export type ClRecord = { customerId: string; serial: string; email: string; name: string; clBalance: number | null; kkBank: number | null; pointsToSend: number | null };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  const t = text.replace(/^﻿/, "").trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  row.push(f);
  rows.push(row);
  return rows.filter((r) => r.join("").trim() !== "");
}

export const MAX_CL_ROWS = 5000;

/** The columns the export was found to have, by their meaning: for the coach's note (names only) and the tests. */
export type ClColumns = { customerId: boolean; serial: boolean; clBalance: boolean; kkBank: boolean; pointsToSend: boolean; name: boolean; email: boolean };

/**
 * The export's pass-linked bot users: those with a pass serial or a Loyalty Customer ID. Every other row (637 bot users in
 * CRH, 17 with a pass) is read past. Headers are matched by meaning, so a pinned field's exact label doesn't matter.
 */
export function parseClExport(text: string): { records: ClRecord[]; columns: ClColumns; rows: number } {
  const raw = parseCsv(text).slice(0, MAX_CL_ROWS + 1);
  const head = (raw.shift() ?? []).map((h) => h.toLowerCase().trim());
  const col = (re: RegExp, not?: RegExp) => head.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const iCustomer = col(/loyalty customer id|customer[ _-]?id/);
  const iSerial = col(/serial/);
  const iBalance = col(/cl points balance|points balance/, /bank|send/);
  const iBank = col(/koins? bank|kindness koins bank/);
  const iSend = col(/points to send/);
  const iFirst = col(/first[ _-]?name|^first$/);
  const iLast = col(/last[ _-]?name|^last$|surname/);
  const iName = col(/^(full )?name$|^user ?name$|^name\b/);
  const iEmail = col(/e-?mail/);
  const records: ClRecord[] = [];
  for (const r of raw) {
    const customerId = iCustomer > -1 ? (r[iCustomer] ?? "").trim() : "";
    const serial = iSerial > -1 ? (r[iSerial] ?? "").trim() : "";
    if (!customerId && !serial) continue;
    let first = iFirst > -1 ? (r[iFirst] ?? "") : "";
    let last = iLast > -1 ? (r[iLast] ?? "") : "";
    if (!first && iName > -1) {
      const p = (r[iName] ?? "").trim().split(/\s+/);
      first = p[0] ?? "";
      last = p.length > 1 ? p[p.length - 1] : "";
    }
    records.push({
      customerId,
      serial,
      email: iEmail > -1 ? (r[iEmail] ?? "").trim().toLowerCase() : "",
      name: displayName(first, last) ?? "Member",
      clBalance: iBalance > -1 ? num(r[iBalance]) : null,
      kkBank: iBank > -1 ? num(r[iBank]) : null,
      pointsToSend: iSend > -1 ? num(r[iSend]) : null,
    });
  }
  return { records, columns: { customerId: iCustomer > -1, serial: iSerial > -1, clBalance: iBalance > -1, kkBank: iBank > -1, pointsToSend: iSend > -1, name: iFirst > -1 || iName > -1, email: iEmail > -1 }, rows: raw.length };
}

// ---------------------------------------------------------------------------------------------------------------------------
// eLoyalty's events for one customer: the latest change to points, read loosely (the path is unverified; the first live call
// logs field names only and this adapts to what is there).

export type LastChange = { at: string; amount: number | null; by: string; kind: string };

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (k in o && o[k] !== null && o[k] !== undefined && o[k] !== "") return o[k];
  return undefined;
};

/** The newest points-related event, or null. Who made it is read from the event's actor or source words, never a name of a person's. */
export function latestChange(eventsJson: unknown): LastChange | null {
  const raw = eventsJson as { data?: unknown[]; events?: unknown[] } | unknown[] | null;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.events) ? raw.events : [];
  let best: LastChange | null = null;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const kind = str(pick(o, ["type", "event_type", "kind", "action"])).toLowerCase();
    const amount = num(pick(o, ["points", "amount", "delta", "points_delta", "value"]));
    if (!/point|earn|redeem|adjust|deduct|add|balance|credit|debit/.test(kind) && amount === null) continue;
    const at = str(pick(o, ["created_at", "timestamp", "occurred_at", "date", "at"]));
    if (!at || Number.isNaN(Date.parse(at))) continue;
    const source = pick(o, ["source", "actor_type", "created_by_type", "channel", "origin"]);
    const actor = pick(o, ["created_by", "actor", "user", "staff", "performed_by"]);
    // Words about the maker, never a person's name: a portal user reads as "team (portal)", a key as "API", a flow as "automation".
    const words = `${str(source)} ${typeof actor === "object" && actor ? JSON.stringify(actor) : str(actor)}`.toLowerCase();
    const by = /portal|dashboard|admin|staff|manual|user/.test(words) ? "team (portal)" : /api|key|integration|webhook/.test(words) ? "API" : /automation|flow|bot|scanner|rule/.test(words) ? "automation" : "unknown";
    if (!best || Date.parse(at) > Date.parse(best.at)) best = { at: new Date(at).toISOString(), amount, by, kind: kind.slice(0, 40) };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The comparison and the snapshot.

export type MatchedBy = "customer id" | "serial" | "email";
export type CheckRow = {
  name: string;
  matchedBy: MatchedBy | null;
  eloyalty: number;
  earned: number;
  cl: number | null;
  kkBank: number | null;
  diff: number | null;
  lastChange: LastChange | null;
  suggested: number;
  reason: string;
  /** On the client's hide list (a team test account, H-110): counted apart, never in the member counts. */
  hidden: boolean;
  template: string;
};
export type Unmatched = { name: string; cl: number | null; kkBank: number | null; hasCustomerId: boolean; hasSerial: boolean };
export type Counts = { passes: number; matched: number; differ: number; gapTotal: number; passesNoCl: number; clNoPass: number; hiddenTests: number; placeholders: number; historyFor: number };
export type Snapshot = { at: string; templates: string[]; columns: ClColumns; clRows: number; counts: Counts; rows: CheckRow[]; clOnly: Unmatched[]; note: string };

const shortTemplate = (t: string) => (t ? t.slice(0, 8) : "all");

/** Why the suggested number is what it is, in plain words. */
export function suggestion(h: PassHolder, cl: ClRecord | null, last: LastChange | null): { suggested: number; reason: string } {
  const base = "eLoyalty is the system of record";
  if (!cl || cl.clBalance === null) return { suggested: h.balance, reason: `${base}; CL holds no balance for this pass` };
  if (cl.clBalance === h.balance) return { suggested: h.balance, reason: "both agree" };
  if (last?.by === "team (portal)") return { suggested: h.balance, reason: `${base}; its last change was made by hand in the portal` };
  if (last?.by === "API" || last?.by === "automation") return { suggested: h.balance, reason: `${base}; its last change came from the ${last.by}; CL's copy is older` };
  return { suggested: h.balance, reason: `${base}; CL's copy ("Get Pass Data") is out of date` };
}

/** Each pass holder with its Community Loyalty record, by customer id, then serial, then email; and the CL records left over. */
export function pairUp(holders: readonly PassHolder[], cl: readonly ClRecord[]): { pairs: { h: PassHolder; rec: ClRecord | null; matchedBy: MatchedBy | null }[]; leftover: ClRecord[] } {
  const byCustomer = new Map<string, ClRecord>();
  const bySerial = new Map<string, ClRecord>();
  const byEmail = new Map<string, ClRecord>();
  for (const r of cl) {
    if (r.customerId && !byCustomer.has(r.customerId)) byCustomer.set(r.customerId, r);
    if (r.serial && !bySerial.has(r.serial)) bySerial.set(r.serial, r);
    if (r.email && !byEmail.has(r.email)) byEmail.set(r.email, r);
  }
  const used = new Set<ClRecord>();
  const pairs: { h: PassHolder; rec: ClRecord | null; matchedBy: MatchedBy | null }[] = [];
  for (const h of holders) {
    let matchedBy: MatchedBy | null = null;
    let rec: ClRecord | null = null;
    if (byCustomer.has(h.id)) {
      rec = byCustomer.get(h.id)!;
      matchedBy = "customer id";
    } else if (h.serial && bySerial.has(h.serial)) {
      rec = bySerial.get(h.serial)!;
      matchedBy = "serial";
    } else if (h.email && byEmail.has(h.email)) {
      rec = byEmail.get(h.email)!;
      matchedBy = "email";
    }
    if (rec) used.add(rec);
    pairs.push({ h, rec, matchedBy });
  }
  return { pairs, leftover: cl.filter((r) => !used.has(r)) };
}

export function compare(holders: readonly PassHolder[], cl: readonly ClRecord[], hidden: ReadonlySet<string>, history: ReadonlyMap<string, LastChange | null>, meta: { at: string; templates: string[]; columns: ClColumns; clRows: number; note: string }): Snapshot {
  const { pairs, leftover } = pairUp(holders, cl);
  const rows: CheckRow[] = [];
  for (const { h, rec, matchedBy } of pairs) {
    const last = history.get(h.id) ?? null;
    const s = suggestion(h, rec, last);
    rows.push({
      name: h.name,
      matchedBy,
      eloyalty: h.balance,
      earned: h.earned,
      cl: rec?.clBalance ?? null,
      kkBank: rec?.kkBank ?? null,
      diff: rec && rec.clBalance !== null ? h.balance - rec.clBalance : null,
      lastChange: last,
      suggested: s.suggested,
      reason: s.reason,
      hidden: hidden.has(h.id),
      template: shortTemplate(h.templateId),
    });
  }
  rows.sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0) || a.name.localeCompare(b.name));
  const clOnly: Unmatched[] = leftover.map((r) => ({ name: r.name, cl: r.clBalance, kkBank: r.kkBank, hasCustomerId: Boolean(r.customerId), hasSerial: Boolean(r.serial) }));
  const members = rows.filter((r) => !r.hidden);
  const counts: Counts = {
    passes: members.length,
    matched: members.filter((r) => r.matchedBy).length,
    differ: members.filter((r) => r.diff !== null && r.diff !== 0).length,
    gapTotal: members.reduce((s, r) => s + Math.abs(r.diff ?? 0), 0),
    passesNoCl: members.filter((r) => !r.matchedBy).length,
    clNoPass: clOnly.length,
    hiddenTests: rows.length - members.length,
    placeholders: holders.filter((h) => h.placeholder).length,
    historyFor: members.filter((r) => r.lastChange).length,
  };
  return { at: meta.at, templates: meta.templates.map(shortTemplate), columns: meta.columns, clRows: meta.clRows, counts, rows, clOnly, note: meta.note };
}

/** The counts in one line, for the inbox and the Forum: never a name. */
export const countsLine = (c: Counts): string => `${c.passes} passes; ${c.matched} match a CL record; ${c.differ} differ (total gap ${c.gapTotal.toLocaleString("en-US")}); ${c.passesNoCl} passes with no CL record; ${c.clNoPass} CL records with no pass; ${c.hiddenTests} team tests counted apart`;

/** The snapshot as it may be stored: "First L." and numbers only. An id, serial, email or long digit run anywhere refuses the whole thing. */
export function snapshotIsClean(s: Snapshot): boolean {
  const text = JSON.stringify({ rows: s.rows, clOnly: s.clOnly });
  return textIsClean(text) && !/wp-[a-z0-9]/i.test(text) && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text);
}

/** Field names only (never a value), for the first live call's log line and the coach's note. */
export const fieldNamesOf = (o: unknown): string[] => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object).sort() : []);

// ---------------------------------------------------------------------------------------------------------------------------
// The id report (H-402 step 2): the same comparison with the ids kept, for Danno's review before any correction is written.

/** The report's columns. Ids and numbers and fixed words only: no name, email or pass serial is ever a column. */
export const ID_REPORT_COLUMNS = ["eloyalty_customer_id", "cl_loyalty_customer_id", "matched_by", "team_test", "lifetime", "available", "cl_balance", "kk_bank", "difference", "last_change_at", "last_change_amount", "last_change_by", "suggested", "reason"] as const;

const cell = (v: string | number | null | undefined): string => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * The comparison as CSV, one row per pass holder (most different first) and then one per Community Loyalty record with no
 * eLoyalty match. Built from ids and numbers alone, so it can go to the inbox for review; it is never stored.
 */
export function idReportCsv(holders: readonly PassHolder[], cl: readonly ClRecord[], hidden: ReadonlySet<string>, history: ReadonlyMap<string, LastChange | null>): string {
  const { pairs, leftover } = pairUp(holders, cl);
  const rows = pairs.map(({ h, rec, matchedBy }) => {
    const last = history.get(h.id) ?? null;
    const s = suggestion(h, rec, last);
    const diff = rec && rec.clBalance !== null ? h.balance - rec.clBalance : null;
    return { diff, cells: [h.id, rec?.customerId ?? "", matchedBy ?? "no CL record", hidden.has(h.id) ? "yes" : "no", h.earned, h.balance, rec?.clBalance ?? null, rec?.kkBank ?? null, diff, last?.at ?? "", last?.amount ?? null, last?.by ?? "unknown", s.suggested, s.reason] };
  });
  rows.sort((a, b) => Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0));
  const extra = leftover.map((r) => ["", r.customerId ?? "", "no eLoyalty match", "no", null, null, r.clBalance, r.kkBank, null, "", null, "", null, r.customerId ? "CL holds a customer id eLoyalty does not have" : "CL record with a pass serial only"]);
  return [ID_REPORT_COLUMNS.join(","), ...rows.map((r) => r.cells.map(cell).join(",")), ...extra.map((c) => c.map(cell).join(","))].join("\n") + "\n";
}
