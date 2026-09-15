/**
 * Has a points push ever returned success? Read-only. Two mechanisms, two answers:
 *   1. the direct path: sync_events rows for points.add and pass.push (provider community_loyalty before 15 Sep, walletpush after)
 *   2. the Elite inbound-webhook path: member_points rows and their sync_status
 * Run against production with the same variables the app uses:
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx scripts/points-push-report.ts
 * Prints counts per event and status, the first and last row of each, and any note on a failure. Nothing is written.
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

(async () => {
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")}`);
  console.log("\n1. Direct path (sync_events, provider community_loyalty or walletpush, direction out)");
  const direct = await client.execute(
    "SELECT provider, event, status, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM sync_events WHERE provider IN ('community_loyalty','walletpush') AND direction='out' GROUP BY provider, event, status ORDER BY provider, event, status",
  );
  if (!direct.rows.length) console.log("  no outbound rows at all: no push was ever attempted (or none was ever recorded)");
  for (const r of direct.rows) console.log(`  ${r.provider} ${r.event} ${r.status}: ${r.n} (${r.first} → ${r.last})`);
  const notes = await client.execute(
    "SELECT event, status, note, COUNT(*) AS n FROM sync_events WHERE provider IN ('community_loyalty','walletpush') AND direction='out' AND status IN ('failed','skipped') GROUP BY event, status, note ORDER BY n DESC LIMIT 20",
  );
  for (const r of notes.rows) console.log(`    ${r.event} ${r.status} ×${r.n}: ${String(r.note ?? "").slice(0, 160)}`);
  const sent = direct.rows.filter((r) => r.status === "sent").reduce((a, r) => a + Number(r.n), 0);
  console.log(sent ? `  => ${sent} outbound row(s) marked sent: read their notes above to see what the service answered` : "  => never a row marked sent: the direct path has never returned success");

  console.log("\n2. Elite inbound-webhook path (member_points.sync_status)");
  const elite = await client.execute("SELECT sync_status, COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM member_points GROUP BY sync_status ORDER BY sync_status");
  if (!elite.rows.length) console.log("  no member_points rows: nothing was ever awarded on this path");
  for (const r of elite.rows) console.log(`  ${r.sync_status}: ${r.n} (${r.first} → ${r.last})`);
  const eliteNotes = await client.execute("SELECT sync_note, COUNT(*) AS n FROM member_points WHERE sync_status='failed' GROUP BY sync_note ORDER BY n DESC LIMIT 10");
  for (const r of eliteNotes.rows) console.log(`    failed ×${r.n}: ${String(r.sync_note ?? "").slice(0, 160)}`);
  const eliteSent = elite.rows.filter((r) => r.sync_status === "sent").reduce((a, r) => a + Number(r.n), 0);
  console.log(eliteSent ? `  => ${eliteSent} webhook post(s) answered 2xx` : "  => never a row marked sent: no webhook post has returned 2xx (local = no webhook URL was set)");
})();
