/**
 * Who the rank catch-up (H-934, H-1047) still owes, in counts only. Read-only; no names, emails or ids are printed.
 * Run against production with the same variables the app uses:
 *   DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npx tsx --tsconfig tsconfig.json scripts/catchup-report.ts
 * For every active membership (members, and coaches on their own login) at Philosopher or above, it applies the same rule the
 * app does on an open (catchUpFor) and counts: due to play, due a silent stamp, done (the clip seen or stamped at the current
 * rank), and waiting on a rank-up first. The clip seen is a level with no time on it, so "done" can't be split into before or
 * after a deploy; run it twice and compare to see it move.
 */
import { createClient } from "@libsql/client";
import { catchUpFor } from "../src/lib/engine/scenes";
import { tierFor } from "../src/lib/engine/tiers";

const url = process.env.DATABASE_URL ?? "file:./data/helixos.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

type Row = { role: string; celebrated: number | null; seen: number | null; points: number; workspace: string; user: string };

(async () => {
  console.log(`database: ${url.replace(/\/\/[^@/]*@/, "//…@")}`);
  const res = await client.execute(`
    SELECT m.role AS role, m.celebrated_tier_level AS celebrated, m.rank_clip_seen_level AS seen, m.workspace_id AS workspace, m.user_id AS user,
           COALESCE((SELECT SUM(p.points) FROM points_ledger p WHERE p.workspace_id = m.workspace_id AND p.user_id = m.user_id), 0) AS points
    FROM memberships m WHERE m.removed_at IS NULL`);
  const rows = res.rows as unknown as Row[];
  const counts: Record<string, Record<string, number>> = { client: {}, coach: {} };
  const add = (role: string, k: string) => {
    const c = (counts[role] ??= {});
    c[k] = (c[k] ?? 0) + 1;
  };
  for (const r of rows) {
    const points = Number(r.points);
    const t = tierFor(points);
    if (t.level <= 1) continue;
    add(r.role, "at Philosopher or above");
    // The coach has no rank-up ceremony: their current rank counts as celebrated (H-1047), as in catchUpShell.
    const celebrated = r.role === "coach" ? t.level : r.celebrated === null ? null : Number(r.celebrated);
    const seen = r.seen === null ? null : Number(r.seen);
    if (celebrated === null) {
      add(r.role, "rank never recorded (stamped, then the catch-up, on next open)");
      continue;
    }
    if ((seen ?? 0) >= t.level) {
      add(r.role, "done (clip seen or stamped)");
      continue;
    }
    const reached = await client.execute({
      sql: `SELECT at FROM (
              SELECT created_at AS at, julianday(created_at) AS jd,
                     SUM(points) OVER (ORDER BY julianday(created_at), id ROWS UNBOUNDED PRECEDING) AS run
              FROM points_ledger WHERE workspace_id = ? AND user_id = ?
            ) WHERE run >= ? ORDER BY jd LIMIT 1`,
      args: [r.workspace, r.user, t.minPoints],
    });
    const due = catchUpFor({ points, celebrated, clipSeen: seen, reachedAt: (reached.rows[0]?.at as string | undefined) ?? null });
    add(r.role, !due ? "a rank-up due first" : due.kind === "play" ? "due to play" : "due a silent stamp");
  }
  for (const role of ["client", "coach"]) {
    console.log(`\n${role === "client" ? "Members" : "Coaches (own login)"}:`);
    const c = counts[role];
    if (!Object.keys(c).length) console.log("  none at Philosopher or above");
    for (const [k, n] of Object.entries(c)) console.log(`  ${k}: ${n}`);
  }
})();
