/**
 * Saving a scale reading, one way for the page, the connector and the RENPHO import (rev 476). A reading that is one already
 * stored (the same minute; or, without a time, the same weight that day) fills in the numbers the stored one lacks and adds
 * nothing else, so a weigh-in typed in the morning and the RENPHO export of the same step are one row on Weigh-ins.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { matchReading, missingValues, type MetricKey, type Reading } from "@/lib/engine/body-scale";
import { groupReadings, type StoredReading } from "@/lib/queries/body";
import { newId } from "@/lib/ids";

type Source = (typeof schema.BODY_SOURCES)[number];
export type Saved = { readingId: string; outcome: "new" | "filled" | "already"; added: MetricKey[] };

/** The member's readings on these days, every source, grouped. */
export async function readingsOn(workspaceId: string, userId: string, dates: string[]): Promise<StoredReading[]> {
  if (!dates.length) return [];
  const rows: schema.BodyDailyRow[] = [];
  for (let i = 0; i < dates.length; i += 200) rows.push(...(await db.query.bodyDaily.findMany({ where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), inArray(schema.bodyDaily.date, dates.slice(i, i + 200))) })));
  return groupReadings(rows);
}

/**
 * Save readings (values stored: masses in lb). `day` is what's already stored on their days (readingsOn), and is updated as
 * readings land, so two readings of one step in the same batch become one too.
 */
export async function saveReadings(workspaceId: string, userId: string, readings: Reading[], source: Source, day?: StoredReading[]): Promise<Saved[]> {
  const known = day ?? (await readingsOn(workspaceId, userId, [...new Set(readings.map((r) => r.date))]));
  const rows: (typeof schema.bodyDaily.$inferInsert)[] = [];
  const out: Saved[] = [];
  for (const x of readings) {
    const match = matchReading(known, x);
    const add = match ? missingValues(match.values, x.values) : x.values;
    const keys = Object.keys(add) as MetricKey[];
    const readingId = match?.readingId ?? newId();
    // A match without a time takes the incoming one's, so the merged reading shows when it was.
    const time = match ? (match.time ?? x.time) : x.time;
    for (const key of keys) rows.push({ id: newId(), workspaceId, userId, date: x.date, key, value: add[key]!, source, readingId, time });
    if (match && !match.time && x.time) await db.update(schema.bodyDaily).set({ time: x.time }).where(and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), eq(schema.bodyDaily.readingId, readingId)));
    if (match) {
      Object.assign(match.values, add);
      match.time = time;
    } else known.push({ readingId, date: x.date, time: x.time, source, createdAt: new Date().toISOString(), values: { ...x.values } });
    out.push({ readingId, outcome: !match ? "new" : keys.length ? "filled" : "already", added: keys });
  }
  for (let i = 0; i < rows.length; i += 400) await db.insert(schema.bodyDaily).values(rows.slice(i, i + 400));
  return out;
}
