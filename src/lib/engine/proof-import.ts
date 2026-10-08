/**
 * Danno's Proof Bank from his Airtable Testimonials table (Danno, 8 Oct): Fathom call clips, each a quote with who said it,
 * the call it came from and its categories. Pure: the reader hands rows in, this says what each becomes, and the action
 * writes. Privacy is a rule here, not a hope: the name is first name and last initial, and an email or phone number in the
 * quote is blanked before it is stored. Nothing here is a client's: it lands in the coach's own member scope.
 */
export const PROOF_IMPORT = {
  baseId: "appw8wwbqmpZBt1ff",
  tableId: "tblSKDyHptX3mghQE",
  fields: { quote: "fldPeHmbgyYudKq8K", client: "fld6TLuWsCdyoUzbh", title: "fldAF0Zxwqt2LQJhG", date: "fldTJIDsiCUIvLaBn", timestamp: "fldGY3aGg5G0nqTj4", link: "fldoEP55xptXyYz15", categories: "fldWF6QdvsqnoG3j4" },
} as const;

/** The categories that come first in the Proof Bank, in this order; every other category follows, by date. */
export const PROOF_TAGS_FIRST = ["Results & Revenue", "Sales Wins", "Transformation"] as const;

export type ImportedProof = {
  airtableId: string;
  name: string;
  who: string;
  quote: string;
  shortVersion: string;
  sourceTitle: string | null;
  sourceRecordedAt: string | null;
  sourceTimestamp: string | null;
  sourceUrl: string | null;
  tags: string[];
};

export type AirtableRow = { id: string; fields: Record<string, unknown> };

/** "Jane Doe" → "Jane D."; "jane" → "Jane"; an email as a name → its first part, capitalised. */
export function shortName(full: string): string {
  const cleaned = full.trim().replace(/<[^>]*>/g, "").split("@")[0].replace(/[._]+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/);
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : "";
  return last ? `${first} ${last}.` : first;
}

/** An email or a phone number in the words, blanked. */
export function scrubContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email removed]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[number removed]" : m));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
/** A timestamp as the clip has it ("12:34" or "1:02:03" or seconds). */
const stamp = (v: unknown): string | null => {
  if (typeof v === "number") {
    const s = Math.round(v);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  }
  return str(v) || null;
};
const day = (v: unknown): string | null => {
  const s = str(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? (s.includes("T") ? s : `${m[0]}T12:00:00.000Z`) : null;
};

/** One row to one proof; null when it has no quote (a clip with nothing said is not proof). */
export function mapTestimonial(row: AirtableRow, clientNames: ReadonlyMap<string, string>): ImportedProof | null {
  const f = PROOF_IMPORT.fields;
  const quote = scrubContacts(str(row.fields[f.quote]));
  if (!quote) return null;
  const clientIds = list(row.fields[f.client]);
  const who = shortName(clientIds.map((id) => clientNames.get(id) ?? "").find(Boolean) ?? "") || "A client";
  const title = str(row.fields[f.title]) || null;
  const snippet = quote.length > 60 ? `${quote.slice(0, 57).trimEnd()}…` : quote;
  return {
    airtableId: row.id,
    name: `${who}: ${snippet}`,
    who,
    quote,
    shortVersion: snippet,
    sourceTitle: title,
    sourceRecordedAt: day(row.fields[f.date]),
    sourceTimestamp: stamp(row.fields[f.timestamp]),
    sourceUrl: /^https?:\/\//i.test(str(row.fields[f.link])) ? str(row.fields[f.link]) : null,
    tags: [...new Set(list(row.fields[f.categories]))],
  };
}

/** The first three categories come first, in their order; the rest keep the order given. */
export function tagRank(tags: readonly string[]): number {
  const i = PROOF_TAGS_FIRST.findIndex((t) => tags.includes(t));
  return i === -1 ? PROOF_TAGS_FIRST.length : i;
}

/** What a run did, in words: "Added 12, skipped 3,591 already in." */
export const importSummary = (added: number, skipped: number, dropped: number): string =>
  `Added ${added.toLocaleString()}, skipped ${skipped.toLocaleString()} already in${dropped ? `, left out ${dropped} with no quote` : ""}.`;
