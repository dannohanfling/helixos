/**
 * Has a points push ever returned success? Read-only. Two mechanisms, two answers:
 *   1. the direct path: sync_events rows for points.add and pass.push (provider community_loyalty before 15 Sep, walletpush after)
 *   2. the Elite inbound-webhook path: member_points rows and their sync_status
 * Run against production with the same variables the app uses:
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx scripts/points-push-report.ts
 * Prints counts per event and status, the first and last row of each, and any note on a failure. Then the key inventory:
 * how many workspaces hold a pass API key, whether any two hold the same value (compared as sha256 of the decrypted value,
 * never printed; needs ENCRYPTION_KEY or SESSION_SECRET), and per member the pass serial, the community webhook and the
 * last push that came back 2xx. Nothing is written and no secret is printed.
 */
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { open } from "../src/lib/crypto";

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

  console.log("\n3. Key inventory (integrations rows for the pass provider, old name and new)");
  const rows = await client.execute("SELECT i.workspace_id, w.name AS workspace, i.provider, i.enabled, i.config, i.inbound_secret_hash IS NOT NULL AS has_inbound_secret FROM integrations i LEFT JOIN workspaces w ON w.id = i.workspace_id WHERE i.provider IN ('community_loyalty','walletpush') ORDER BY w.name, i.provider");
  const fingerprints = new Map<string, string[]>();
  let withKey = 0;
  let undecryptable = 0;
  for (const r of rows.rows) {
    let cfg: Record<string, string> = {};
    try {
      cfg = JSON.parse(String(r.config ?? "{}"));
    } catch {
      cfg = {};
    }
    const hasKey = Boolean(cfg.apiKey);
    if (hasKey) withKey++;
    let fp = "";
    if (hasKey) {
      try {
        const plain = open(cfg.apiKey);
        fp = plain ? createHash("sha256").update(plain).digest("hex").slice(0, 12) : "";
      } catch {
        undecryptable++;
      }
    }
    if (fp) fingerprints.set(fp, [...(fingerprints.get(fp) ?? []), `${r.workspace ?? r.workspace_id}/${r.provider}`]);
    console.log(`  ${r.workspace ?? r.workspace_id} ${r.provider}: enabled=${r.enabled ? "yes" : "no"} apiKey=${hasKey ? "set" : "not set"} host=${cfg.apiUrl ?? "(none)"} inboundSecret=${r.has_inbound_secret ? "set" : "not set"}`);
  }
  const dupes = [...fingerprints.values()].filter((v) => v.length > 1);
  console.log(`  => ${withKey} row(s) hold a pass API key${undecryptable ? ` (${undecryptable} could not be decrypted here: set ENCRYPTION_KEY or SESSION_SECRET to compare values)` : ""}`);
  console.log(dupes.length ? `  => the same key value is held by: ${dupes.map((d) => d.join(" and ")).join("; ")}` : "  => no two rows hold the same key value");

  console.log("\n4. Per member: pass serial, community webhook, last push that came back 2xx");
  const members = await client.execute(
    "SELECT u.name, m.eo_pass_serial AS serial, m.eo_pass_installed_at AS installed, m.pass_webhook_url IS NOT NULL AND m.pass_webhook_url <> '' AS has_webhook, (SELECT MAX(created_at) FROM sync_events s WHERE s.user_id = m.user_id AND s.provider IN ('community_loyalty','walletpush') AND s.direction='out' AND s.status='sent') AS last_ok FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role='client' ORDER BY u.name",
  );
  for (const r of members.rows) console.log(`  ${r.name}: serial=${r.serial ? "set" : "none"} installed=${r.installed ? "yes" : "no"} communityWebhook=${r.has_webhook ? "set" : "none"} lastSuccessfulPush=${r.last_ok ?? "never"}`);
})();
