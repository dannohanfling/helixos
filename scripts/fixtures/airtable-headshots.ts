/**
 * A synthetic Fulfillment table for the client headshots walk (Danno, 8 Oct): the real base, table and field ids, so the import
 * asks for exactly what it maps, and invented people. Nobody's data or face is in here, by rule: each photo is a flat colour
 * square the mock draws on request, at the mock's own address (Airtable's would expire in a few hours).
 *
 * The rows: Maya's sign-in email in odd case with spaces (matched), Jordan's (matched, a PNG), one with no email, two sharing an
 * email, one whose email is no member's (four to review), and one with no headshot.
 */
import type { FixtureRecord, FixtureTable } from "./airtable-client";

export const FULFILLMENT_TABLE = "tblxCBKthZ4EmmV6Y";
const F = { headshot: "fldFwZgWGRUpvGy2t", name: "fldew4IZxIiKwarHT", email: "fld3PV6STUBAFyfeT" };
const rec = (id: string, fields: Record<string, unknown>): FixtureRecord => ({ id, createdTime: "2026-09-01T09:00:00.000Z", fields });
export const attachment = (port: number, id: string, type = "image/jpeg") => ({ id, url: `http://localhost:${port}/__attachments/${id}.${type === "image/png" ? "png" : "jpg"}`, type, size: 4000, filename: `${id}.${type === "image/png" ? "png" : "jpg"}`, width: 900, height: 1200 });

export function fulfillmentTable(port: number): FixtureTable {
  return {
    id: FULFILLMENT_TABLE,
    name: "Fulfillment",
    fields: [
      { id: F.headshot, name: "Headshot", type: "multipleAttachments" },
      { id: F.name, name: "Name", type: "singleLineText" },
      { id: F.email, name: "Email", type: "email" },
    ],
    records: [
      rec("recHEAD000000001", { [F.name]: "Maya Torres", [F.email]: "  Client@Demo.HelixOS.app ", [F.headshot]: [attachment(port, "attMAYA000000001"), attachment(port, "attMAYA000000002")] }),
      rec("recHEAD000000002", { [F.name]: "Jordan Lee", [F.email]: "client2@demo.helixos.app", [F.headshot]: [attachment(port, "attJORDAN0000001", "image/png")] }),
      rec("recHEAD000000003", { [F.name]: "Riley Noemail", [F.headshot]: [attachment(port, "attRILEY00000001")] }),
      rec("recHEAD000000004", { [F.name]: "Sam Shared", [F.email]: "shared@example.com", [F.headshot]: [attachment(port, "attSHARED0000001")] }),
      rec("recHEAD000000005", { [F.name]: "Sky Shared", [F.email]: "Shared@Example.com", [F.headshot]: [attachment(port, "attSHARED0000002")] }),
      rec("recHEAD000000006", { [F.name]: "Nora Nomatch", [F.email]: "nobody@example.com", [F.headshot]: [attachment(port, "attNOMATCH000001")] }),
      rec("recHEAD000000007", { [F.name]: "Pat Nophoto", [F.email]: "nophoto@example.com" }),
    ],
  };
}
