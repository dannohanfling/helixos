import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { RESEAL_COLUMNS, classifySealed, countLine, emptyCount } from "../reseal";
import { openWith, sealWith } from "@/lib/crypto";

const OLD = "old-key-old-key-old-key-old-key-old-key-1";
const NEW = "new-key-new-key-new-key-new-key-new-key-2";

describe("re-sealing under a new ENCRYPTION_KEY (H-349 §5)", () => {
  it("every listed column exists on its table", () => {
    for (const c of RESEAL_COLUMNS) {
      const table = (schema as unknown as Record<string, unknown>)[c.table] as Parameters<typeof getTableColumns>[0] | undefined;
      expect(table, c.table).toBeTruthy();
      expect(Object.keys(getTableColumns(table!)), `${c.table}.${c.column}`).toContain(c.column);
      expect(typeof getTableName(table!)).toBe("string");
    }
    expect(RESEAL_COLUMNS.length).toBeGreaterThanOrEqual(14);
  });
  it("sealWith and openWith work by key, and a value sealed under one key does not open under another", () => {
    const sealed = sealWith("sk-live-abc", OLD)!;
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(openWith(sealed, OLD)).toBe("sk-live-abc");
    expect(openWith(sealed, NEW)).toBeNull();
    expect(openWith("plain", NEW)).toBe("plain");
    expect(sealWith(null, NEW)).toBeNull();
  });
  it("classifies a value: plain, under the old key, already new, unreadable", () => {
    const old = sealWith("x", OLD);
    const nu = sealWith("x", NEW);
    const classify = (v: string | null) => classifySealed(v, openWith(v, OLD) !== null, openWith(v, NEW) !== null);
    expect(classify(null)).toBe("plain");
    expect(classify("not sealed")).toBe("plain");
    expect(classify(old)).toBe("old");
    expect(classify(nu)).toBe("new");
    expect(classify(sealWith("x", "a-third-key-a-third-key-a-third-key-3"))).toBe("unreadable");
  });
  it("the count line reads in plain words", () => {
    const c = emptyCount();
    c.old = 12;
    c.unreadable = 1;
    c.plain = 3;
    expect(countLine("members' AI keys", c)).toBe("members' AI keys: 12 under the old key, 0 already new, 1 unreadable, 3 plain");
  });
});
