import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "@/db/schema";
import { CHILD_TABLES, MEMBER_TABLES, NOT_MEMBER_DATA, STRIP_COLUMNS, USER_TABLES, WORKSPACE_TABLES } from "@/lib/member-data";

const tables = (Object.values(schema) as unknown[]).filter((v) => is(v, SQLiteTable)) as SQLiteTable[];
const nameOf = (t: SQLiteTable): string => getTableName(t);
const cols = (t: SQLiteTable) => Object.keys(getTableColumns(t));

describe("one list of a member's data, read by the export and by deletion on request", () => {
  it("every table in the schema is placed exactly once, or excluded with its reason", () => {
    expect(tables.length).toBeGreaterThan(60);
    const placed = [
      ...Object.values(MEMBER_TABLES).map(nameOf),
      ...CHILD_TABLES.map((c) => getTableName(c.table)),
      ...Object.values(USER_TABLES).map(nameOf),
      ...Object.values(WORKSPACE_TABLES).map(nameOf),
      ...Object.keys(NOT_MEMBER_DATA),
    ];
    expect(placed.length, "a table is placed twice").toBe(new Set(placed).size);
    expect(tables.map(nameOf).filter((n) => !placed.includes(n)), "a table is in no list").toEqual([]);
    expect(placed.filter((n) => !tables.map(nameOf).includes(n)), "a list names a table that no longer exists").toEqual([]);
    for (const [n, why] of Object.entries(NOT_MEMBER_DATA)) expect(why.length, n).toBeGreaterThan(20);
  });
  it("each list's tables carry the columns it keys on", () => {
    for (const [label, t] of Object.entries(MEMBER_TABLES)) expect(cols(t), label).toEqual(expect.arrayContaining(["id", "workspaceId", "userId"]));
    for (const c of CHILD_TABLES) expect(cols(c.table), c.label).toEqual(expect.arrayContaining(["id", c.fk]));
    for (const [label, t] of Object.entries(USER_TABLES)) {
      expect(cols(t), label).toEqual(expect.arrayContaining(["id", "userId"]));
      expect(cols(t), `${label} is keyed by the user alone`).not.toContain("workspaceId");
    }
    for (const [label, t] of Object.entries(WORKSPACE_TABLES)) {
      expect(cols(t), label).toContain("workspaceId");
      expect(cols(t), `${label} has no owner of its own`).not.toContain("userId");
    }
  });
  it("every child hangs off a member table, the membership, or a child listed before it", () => {
    const seen = new Set<string>(["membership", ...Object.keys(MEMBER_TABLES)]);
    for (const c of CHILD_TABLES) {
      expect(seen.has(c.parent), `${c.label}'s parent ${c.parent}`).toBe(true);
      seen.add(c.label);
    }
  });
  it("every table with a user column is a member's, a user's or a child's, never quietly left out", () => {
    const owned = new Set([...Object.values(MEMBER_TABLES), ...Object.values(USER_TABLES), ...CHILD_TABLES.map((c) => c.table)].map(nameOf));
    const withUser = tables.filter((t) => cols(t).includes("userId")).map(nameOf);
    expect(withUser.filter((n) => !owned.has(n) && n !== "memberships")).toEqual([]);
  });
  it("credentials never leave in an export: every sealed or hashed column is stripped", () => {
    const secretish = tables.flatMap((t) => cols(t).filter((c) => /Encrypted$|Hash$|Token$|Secret|WebhookUrl$/.test(c)));
    expect(secretish.length).toBeGreaterThan(4);
    for (const c of secretish) expect(STRIP_COLUMNS.has(c), c).toBe(true);
  });
});

describe("deletion on request removes stored objects before their rows, and a refusal stops the run", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/erase.ts"), "utf8");
  it("objects first, then the rows, then the membership, the account and the workspace, and the audit row last", () => {
    const order = ["// 1. Objects first", "// 2. The rows", "// 3. The membership", "// 4. One audit row"].map((m) => src.indexOf(m));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Inside the object phase, a refusal throws before the row that pointed at it is touched.
    const phase = src.slice(order[0], order[1]);
    expect(phase.indexOf("throw new EraseStopped")).toBeLessThan(phase.indexOf("db.delete(schema.proofAttachments)"));
    expect(phase.indexOf("throw new EraseStopped")).toBeLessThan(phase.indexOf("db.delete(schema.deckImages)"));
  });
  it("the audit row carries counts and the email, never content", () => {
    const audit = src.slice(src.indexOf("async function audit("));
    expect(audit).toMatch(/deletedEmail: plan\.email, counts, objects,/);
    expect(audit).not.toMatch(/plan\.name|plan\.ids|plan\.objects/);
    // A run the store stopped is on the record too, before the error leaves.
    const phase = src.slice(src.indexOf("// 1. Objects first"), src.indexOf("// 2. The rows"));
    expect(phase.indexOf("await audit(")).toBeLessThan(phase.indexOf("throw new EraseStopped"));
    expect(Object.keys(getTableColumns(schema.deletionAudits)).sort()).toEqual(["counts", "createdAt", "deletedEmail", "id", "objects", "ranByUserId", "stoppedAt", "userRemoved", "workspaceId", "workspaceRemoved"].sort());
  });
});
