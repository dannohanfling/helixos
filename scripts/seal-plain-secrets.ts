/**
 * Seals credentials that were stored before their column was sealed: today the client's Community Loyalty community webhook
 * (memberships.pass_webhook_url) and the coach's Rung Dripper webhook (memberships.cl_drip_webhook_url). Dry run by default:
 * it counts the plain rows and prints nothing of their values. With --apply it seals them in place, which needs the same
 * ENCRYPTION_KEY (or SESSION_SECRET) the app runs with, or the app could not open them afterwards.
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… ENCRYPTION_KEY=… npx tsx scripts/seal-plain-secrets.ts [--apply]
 */
import { createClient } from "@libsql/client";
import { isSealed, seal } from "../src/lib/crypto";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
const COLUMNS = ["pass_webhook_url", "cl_drip_webhook_url"];

(async () => {
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")} (${apply ? "APPLY" : "dry run"})`);
  for (const col of COLUMNS) {
    const r = await client.execute(`SELECT id, ${col} AS v FROM memberships WHERE ${col} IS NOT NULL AND ${col} <> ''`);
    const plain = r.rows.filter((row) => !isSealed(String(row.v)));
    console.log(`memberships.${col}: ${r.rows.length} set, ${plain.length} still plain`);
    if (!apply) continue;
    for (const row of plain) {
      await client.execute({ sql: `UPDATE memberships SET ${col} = ? WHERE id = ?`, args: [seal(String(row.v)), String(row.id)] });
    }
    if (plain.length) console.log(`  sealed ${plain.length} row(s)`);
  }
})();
