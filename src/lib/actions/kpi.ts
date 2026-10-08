"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { KPI_PERIODS, KPI_SOURCES, type KpiPeriod, type KpiSource } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { readMoney } from "@/lib/engine/money";
import { TARGET_METRICS } from "@/lib/engine/targets";
import { ownRecord } from "@/lib/queries/plan";
import { ownKpi, putKpiValue } from "@/lib/queries/kpi";

/**
 * Business goals BG2: a member's KPIs, scoped to the workspace and member on every write. A KPI measures one of the member's
 * own goals or key results; a value is written only to a KPI of the member's own, and never to a Numbers one (its actual is
 * the daily logs, never typed twice).
 */
const periodOf = (v: string): KpiPeriod => KPI_PERIODS.find((k) => k === v) ?? "month";
const sourceOf = (v: string): KpiSource => KPI_SOURCES.find((k) => k === v) ?? "manual";
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
/** A number the way people write it ("5k", "$1,200"), or null when it can't be read. */
const amount = (v: string): number | null => { const m = readMoney(v); return "error" in m ? null : (m.value ?? null); };

/** A new KPI on one of the member's goals or key results. */
export async function createKpiAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const record = await ownRecord({ workspaceId, userId }, str(formData, "recordId"));
  if (!record || record.kind === "initiative") return;
  const back = `/goals/${record.id}`;
  const name = str(formData, "name").trim().slice(0, 120);
  if (!name) redirect(`${back}?kpiError=${encodeURIComponent("Give the KPI a name.")}#kpis`);
  const target = amount(str(formData, "target"));
  if (target === null) redirect(`${back}?kpiError=${encodeURIComponent("The target has to be a number, like 12 or 5k.")}#kpis`);
  const source = sourceOf(str(formData, "source"));
  const metricKey = str(formData, "metric");
  const metric = source === "numbers" ? (TARGET_METRICS.find((t) => t.key === metricKey) ?? null) : null;
  if (source === "numbers" && !metric) redirect(`${back}?kpiError=${encodeURIComponent("Pick which number it reads.")}#kpis`);
  const period = periodOf(str(formData, "period"));
  const unit = (metric?.money ? "$" : opt(formData, "unit")?.trim().slice(0, 20)) || "count";
  await db.insert(schema.kpis).values({ id: newId(), workspaceId, userId, recordId: record.id, name, unit, target, period, periodStart: period === "range" ? day(opt(formData, "periodStart")) : null, periodEnd: period === "range" ? day(opt(formData, "periodEnd")) : null, source, metric: metric?.key ?? null });
  refresh();
  redirect(`${back}#kpis`);
}

/** The KPI's name and target. */
export async function updateKpiAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const kpi = await ownKpi({ workspaceId, userId }, str(formData, "id"));
  if (!kpi) return;
  const name = str(formData, "name").trim().slice(0, 120) || kpi.name;
  const target = amount(str(formData, "target"));
  await db.update(schema.kpis).set({ name, target: target ?? kpi.target }).where(and(eq(schema.kpis.id, kpi.id), eq(schema.kpis.userId, userId)));
  refresh();
}

/** A value typed by hand for a day (one per KPI per day; the day's earlier value is replaced). */
export async function logKpiValueAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const kpi = await ownKpi({ workspaceId, userId }, str(formData, "kpiId"));
  if (!kpi || kpi.source === "numbers") return;
  const value = amount(str(formData, "value"));
  if (value === null) redirect(`/goals/${kpi.recordId}?kpiError=${encodeURIComponent("The value has to be a number, like 3 or 1.2k.")}#kpis`);
  await putKpiValue({ workspaceId, userId }, kpi, day(opt(formData, "date")) ?? v.today, value);
  refresh();
}

/** Archived, never deleted: its values stay; it comes off the record, the tree and the close. */
export async function archiveKpiAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const kpi = await ownKpi({ workspaceId, userId }, str(formData, "id"));
  if (!kpi) return;
  await db.update(schema.kpis).set({ archivedAt: nowIso() }).where(and(eq(schema.kpis.id, kpi.id), eq(schema.kpis.userId, userId)));
  refresh();
}
