/**
 * What a program's pass templates look like (H-1822, plan H-1826 approved in H-1836). Read-only: two kinds of GET to the pass
 * service, nothing written anywhere. Run once by Architectus against production, for one workspace:
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… ENCRYPTION_KEY=… npx tsx scripts/pass-template-inspect.ts <workspaceId>
 * It opens that workspace's own-program key in memory only, reads the template list, then the details of the newest template
 * and the one the program uses. It prints structure only (labels, placeholders, colours, image sizes, barcode, links, flags):
 * never the key, and nothing that could be a member (emails, phone numbers, ids and serials are hidden by redactTemplate).
 */
import { createClient } from "@libsql/client";
import { open } from "../src/lib/crypto";
import { redactTemplate, templateRows } from "../src/lib/engine/template-inspect";

const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
const workspaceId = process.argv[2] ?? "";

async function get(host: string, key: string, path: string): Promise<{ status: number; json: unknown }> {
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}${path}`, { method: "GET", headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    try {
      return { status: res.status, json: JSON.parse(text) };
    } catch {
      return { status: res.status, json: null };
    }
  } catch {
    return { status: 0, json: null };
  }
}

(async () => {
  if (!workspaceId) throw new Error("give the workspace id as the first argument");
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")}`);
  // The workspace's own program: a coach's feed in that workspace with a key and a template (as ownProgram picks it).
  const feeds = await client.execute({
    sql: "SELECT f.host, f.key_encrypted, f.template_id FROM leaderboard_feeds f JOIN memberships m ON m.id = f.membership_id WHERE f.workspace_id = ? AND m.workspace_id = ? AND m.role = 'coach' AND f.key_encrypted IS NOT NULL AND f.template_id IS NOT NULL LIMIT 1",
    args: [workspaceId, workspaceId],
  });
  const feed = feeds.rows[0];
  if (!feed) throw new Error("no own program with a key and a template in that workspace");
  const key = open(String(feed.key_encrypted));
  if (!key) throw new Error("the stored key could not be opened (ENCRYPTION_KEY or SESSION_SECRET missing or different)");
  const host = String(feed.host);
  const liveId = String(feed.template_id);

  const list = await get(host, key, "/api/external/v1/templates");
  console.log(`\n1. Template list: answered ${list.status}`);
  if (list.status < 200 || list.status >= 300) throw new Error(`the template list answered ${list.status}`);
  const rows = templateRows(list.json);
  for (const r of rows) console.log(`  ${r.name} · ${r.shortId} · style ${r.style} · created ${r.created} · updated ${r.updated}${r.id === liveId ? " · USED BY THIS PROGRAM" : ""}`);
  if (!rows.some((r) => r.id === liveId)) console.log(`  (the program's template ${liveId.slice(0, 8)} is not in the list)`);
  const ids = new Set<string>();
  for (const r of rows.slice(0, 1)) ids.add(r.id);
  ids.add(liveId);

  let n = 2;
  for (const id of ids) {
    const dated = rows.some((r) => r.updated !== "not given" || r.created !== "not given");
    const first = dated ? "newest" : "first in the list (the service gave no dates)";
    const which = id === liveId ? (rows[0]?.id === id ? `${first}, and used by this program` : "used by this program") : first;
    const d = await get(host, key, `/api/external/v1/templates/${encodeURIComponent(id)}`);
    console.log(`\n${n++}. Template ${id.slice(0, 8)} (${which}): answered ${d.status}`);
    if (d.status < 200 || d.status >= 300) {
      console.log("  the service gives no details for a template here; the Pass Designer is the way to see its layout");
      continue;
    }
    console.log(JSON.stringify(redactTemplate(d.json, key), null, 2));
  }
  console.log("\nNothing was written. The key was never printed.");
  client.close();
})().catch((e) => {
  console.error(`pass-template-inspect failed: ${e instanceof Error ? e.message : "error"}`);
  process.exit(1);
});
