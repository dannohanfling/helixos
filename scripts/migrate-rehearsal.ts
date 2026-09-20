/**
 * Rehearse the pending migrations against a database that has data in it: a copy of production, or the demo database seeded
 * at the previous version. Counts the rows and sums the numbers that a table rebuild copies, before and after, and says what
 * changed. `DATABASE_URL=file:/path/to/copy.db npx tsx scripts/migrate-rehearsal.ts`. Never point it at production itself.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("Set DATABASE_URL to a local copy (file:...). This script rehearses; it never runs against a remote database.");
  process.exit(2);
}
const client = createClient({ url });
type Row = Record<string, unknown>;
const q = async (sql: string): Promise<Row[]> => (await client.execute(sql)).rows as Row[];
const one = async (sql: string): Promise<Row> => (await q(sql))[0] ?? {};

async function snapshot() {
  const tables = (await q("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name")).map((r) => String(r.name));
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number((await one(`select count(*) as n from "${t}"`)).n ?? 0);
  const offers = await one("select count(*) as n, coalesce(sum(price),0) as price from offers").catch(() => ({}));
  const webinars = await one("select count(*) as n, coalesce(sum(registered),0) as registered, coalesce(sum(revenue),0) as revenue from webinars").catch(() => ({}));
  const applied = (await q("select count(*) as n from __drizzle_migrations").catch(() => [{ n: 0 }]))[0]?.n;
  return { tables: tables.length, counts, offers, webinars, applied: Number(applied ?? 0) };
}

async function main() {
  const before = await snapshot();
  console.log("before:", JSON.stringify({ applied: before.applied, tables: before.tables, offers: before.offers, webinars: before.webinars }));
  await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const after = await snapshot();
  console.log("after: ", JSON.stringify({ applied: after.applied, tables: after.tables, offers: after.offers, webinars: after.webinars }));
  const lost = Object.entries(before.counts).filter(([t, n]) => (after.counts[t] ?? 0) !== n);
  if (lost.length) {
    console.error("row counts changed:", lost.map(([t, n]) => `${t} ${n} -> ${after.counts[t] ?? "gone"}`).join(", "));
    process.exit(1);
  }
  console.log(`ok: ${after.applied - before.applied} migration(s) applied, every table kept its rows, offers keep their prices, webinars keep their numbers`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
