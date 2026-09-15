/**
 * The sync log for a window, read-only: what HelixOS sent to GoHighLevel and what came back, one line per row. For the
 * question "were three requests made or one?": every channel a post is scheduled to is one row (sent, failed or skipped),
 * so a post to three channels shows three rows or says which are missing.
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx scripts/sync-log.ts 2026-09-15 [2026-09-16] [gohighlevel]
 * Notes are already redacted when written; nothing here writes.
 */
import { createClient } from "@libsql/client";

const [from, to = "2100-01-01", provider = "gohighlevel"] = process.argv.slice(2);
if (!from) {
  console.error("usage: npx tsx scripts/sync-log.ts <from YYYY-MM-DD> [to YYYY-MM-DD] [provider]");
  process.exit(2);
}
const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

(async () => {
  const r = await client.execute({
    sql: "SELECT s.created_at, u.name AS who, s.direction, s.event, s.status, s.payload, s.note FROM sync_events s LEFT JOIN users u ON u.id = s.user_id WHERE s.provider = ? AND s.created_at >= ? AND s.created_at < ? ORDER BY s.created_at",
    args: [provider, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`],
  });
  console.log(`${r.rows.length} row(s) for ${provider} from ${from} to ${to}`);
  for (const row of r.rows) {
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(String(row.payload ?? "{}"));
    } catch {
      p = {};
    }
    const bits = ["channel", "postAt", "scheduleDate", "accountId", "ghlPostId", "stage", "kind"].filter((k) => p[k] !== undefined).map((k) => `${k}=${String(p[k])}`);
    console.log(`${row.created_at}  ${row.who ?? "-"}  ${row.direction} ${row.event} ${row.status}  ${bits.join(" ")}\n    ${String(row.note ?? "").slice(0, 300)}`);
  }
})();
