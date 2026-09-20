/**
 * A table rebuild copies rows from the old table into a new one. drizzle-kit writes the copy with every column of the NEW
 * schema, so a migration that both adds a column and rebuilds the table selects a column the old table does not have and
 * fails on every database. This reads each migration's copy statements and checks every selected column against the
 * previous snapshot's columns for that table. Runs in the release gate; exits 1 with the file, table and column named.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), process.env.MIGRATIONS_DIR ?? "drizzle");
const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
type Snapshot = { tables: Record<string, { name: string; columns: Record<string, { name: string }> }> };
const columnsBefore = (idx: number, table: string): Set<string> | null => {
  const file = path.join(dir, "meta", `${String(idx - 1).padStart(4, "0")}_snapshot.json`);
  if (!fs.existsSync(file)) return null;
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  const t = Object.values(snap.tables).find((x) => x.name === table);
  return t ? new Set(Object.values(t.columns).map((c) => c.name)) : null;
};
let problems = 0;
for (const e of journal.entries) {
  const sql = fs.readFileSync(path.join(dir, `${e.tag}.sql`), "utf8");
  for (const m of sql.matchAll(/INSERT INTO `__new_(\w+)`\(([^)]*)\) SELECT ([^;]*?) FROM `(\w+)`/g)) {
    const [, target, , selected, source] = m;
    const before = columnsBefore(e.idx, source);
    if (!before) continue;
    const cols = selected.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    for (const c of cols) {
      if (!before.has(c)) {
        problems++;
        console.error(`${e.tag}.sql: the copy into __new_${target} selects "${c}" from ${source}, which the previous snapshot does not have. Drop it from both lists; the new column takes its default.`);
      }
    }
  }
}
if (problems) process.exit(1);
console.log(`check-migrations: ${journal.entries.length} migrations, every rebuild copies only columns the old table has`);
