/**
 * A synthetic Testimonials table for the Proof Bank import walk (Danno, 8 Oct): the real base, table and field ids, so the
 * reader asks for exactly what the import maps, and invented people and words. Nobody's data is in here, by rule.
 */
import type { FixtureRecord, FixtureTable } from "./airtable-client";

export const TESTIMONIALS_BASE = "appw8wwbqmpZBt1ff";
export const TESTIMONIALS_TOKEN = "pat-testimonials-good";
export const TESTIMONIALS_TABLE = "tblSKDyHptX3mghQE";
export const CLIENTS_TABLE = "tblCLIENTS0000001";

const F = { quote: "fldPeHmbgyYudKq8K", client: "fld6TLuWsCdyoUzbh", title: "fldAF0Zxwqt2LQJhG", date: "fldTJIDsiCUIvLaBn", timestamp: "fldGY3aGg5G0nqTj4", link: "fldoEP55xptXyYz15", categories: "fldWF6QdvsqnoG3j4" };
const rec = (id: string, fields: Record<string, unknown>): FixtureRecord => ({ id, createdTime: "2026-09-01T09:00:00.000Z", fields });

const clients: FixtureTable = {
  id: CLIENTS_TABLE,
  name: "Clients",
  fields: [{ id: "fldCLIENTNAME001", name: "Name", type: "singleLineText" }],
  records: [rec("recCLIENT00000001", { fldCLIENTNAME001: "Marisol Quintero" }), rec("recCLIENT00000002", { fldCLIENTNAME001: "tomas.ferreira@example.com" })],
};
const testimonials: FixtureTable = {
  id: TESTIMONIALS_TABLE,
  name: "Testimonials",
  fields: [
    { id: F.quote, name: "Quote", type: "multilineText" },
    { id: F.client, name: "Client", type: "multipleRecordLinks", options: { linkedTableId: CLIENTS_TABLE } },
    { id: F.title, name: "Call", type: "singleLineText" },
    { id: F.date, name: "Call date", type: "date" },
    { id: F.timestamp, name: "Timestamp", type: "singleLineText" },
    { id: F.link, name: "Fathom", type: "url" },
    { id: F.categories, name: "Categories", type: "multipleSelects" },
  ],
  records: [
    rec("recTESTI000000001", { [F.quote]: "I closed three clients this week at the new price, no discount.", [F.client]: ["recCLIENT00000001"], [F.title]: "Weekly coaching call", [F.date]: "2026-08-14", [F.timestamp]: "12:40", [F.link]: "https://fathom.video/share/synthetic-1", [F.categories]: ["Sales Wins", "Mindset"] }),
    rec("recTESTI000000002", { [F.quote]: "Honestly I feel like a different person. Email me at marisol@example.com or call 555 010 0123.", [F.client]: ["recCLIENT00000001"], [F.title]: "Office Hours", [F.date]: "2026-08-21", [F.timestamp]: 754, [F.link]: "https://fathom.video/share/synthetic-2", [F.categories]: ["Transformation"] }),
    rec("recTESTI000000003", { [F.quote]: "Revenue doubled since June.", [F.client]: ["recCLIENT00000002"], [F.title]: "1:1 call", [F.date]: "2026-09-02", [F.timestamp]: "3:05", [F.link]: "https://fathom.video/share/synthetic-3", [F.categories]: ["Results & Revenue"] }),
    rec("recTESTI000000004", { [F.client]: ["recCLIENT00000002"], [F.title]: "1:1 call", [F.date]: "2026-09-02", [F.categories]: ["Mindset"] }),
  ],
};
export const TESTIMONIALS_TABLES: FixtureTable[] = [testimonials, clients];
