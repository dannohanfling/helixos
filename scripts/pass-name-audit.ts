/**
 * How many passes may carry a wrong name (H-1699, plan H-1701)? Read-only, database only: nothing is sent to the pass service.
 * Per workspace with a keyed program (a leaderboard feed with a key and a template), the members with a pass, how many of those
 * have a one-word name in HelixOS (their pass was made with a blank last name, so it may show the template's prompt), and how
 * many were flagged "Name needs fixing" when their pass was made. Counts only: no names, emails, serials or keys are printed;
 * a workspace is shown by its id.
 * Run against production with the same variables the app uses:
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx scripts/pass-name-audit.ts
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

(async () => {
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")}`);
  const rows = await client.execute(`
    SELECT m.workspace_id AS ws,
      COUNT(*) AS passes,
      SUM(CASE WHEN instr(trim(u.name), ' ') = 0 THEN 1 ELSE 0 END) AS one_word,
      SUM(CASE WHEN m.eo_name_needs_fix = 1 THEN 1 ELSE 0 END) AS flagged
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.eo_pass_serial IS NOT NULL
      AND m.workspace_id IN (SELECT workspace_id FROM leaderboard_feeds WHERE key_encrypted IS NOT NULL AND template_id IS NOT NULL)
    GROUP BY m.workspace_id
    ORDER BY passes DESC`);
  if (!rows.rows.length) console.log("no passes in any workspace with a keyed program");
  let passes = 0;
  let oneWord = 0;
  let flagged = 0;
  for (const r of rows.rows) {
    console.log(`  workspace ${r.ws}: ${r.passes} pass(es), ${r.one_word} with a one-word name, ${r.flagged} flagged at create`);
    passes += Number(r.passes);
    oneWord += Number(r.one_word);
    flagged += Number(r.flagged);
  }
  console.log(`=> ${passes} pass(es) in all, ${oneWord} with a one-word name, ${flagged} flagged. Nothing was written.`);
  client.close();
})().catch((e) => {
  console.error(`pass-name-audit failed: ${e instanceof Error ? e.message : "error"}`);
  process.exit(1);
});
