import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

/** Migration 0127 (Business goals BG2): the KPIs and their values, one value per KPI per day, nothing else touched. */
const SQL = readFileSync(path.join(process.cwd(), "drizzle", "0127_kpis.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("migration 0127: KPIs", () => {
  it("makes kpis and kpi_values, with the KPI defaults and one value per KPI per day", async () => {
    const c = createClient({ url: ":memory:" });
    for (const s of SQL) await c.execute(s);
    const tables = (await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).rows.map((r) => r.name);
    expect(tables).toEqual(["kpi_values", "kpis"]);
    await c.execute("INSERT INTO kpis (id, workspace_id, user_id, record_id, name) VALUES ('k1', 'w', 'u', 'r1', 'Calls booked')");
    const r = (await c.execute("SELECT unit, target, period, source, metric, archived_at FROM kpis")).rows[0];
    expect([r.unit, r.target, r.period, r.source, r.metric, r.archived_at]).toEqual(["count", 0, "month", "manual", null, null]);
    await c.execute("INSERT INTO kpi_values (id, workspace_id, user_id, kpi_id, date, value) VALUES ('v1', 'w', 'u', 'k1', '2026-10-08', 3)");
    await expect(c.execute("INSERT INTO kpi_values (id, workspace_id, user_id, kpi_id, date, value) VALUES ('v2', 'w', 'u', 'k1', '2026-10-08', 4)")).rejects.toThrow();
    await c.execute("INSERT INTO kpi_values (id, workspace_id, user_id, kpi_id, date, value) VALUES ('v3', 'w', 'u', 'k1', '2026-10-09', 4)");
    expect((await c.execute("SELECT count(*) AS n FROM kpi_values")).rows[0].n).toBe(2);
  });
});
