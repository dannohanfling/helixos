/**
 * Re-seal every stored secret under a new ENCRYPTION_KEY (H-349 §5, docs/runbooks/keys.md):
 *   OLD_ENCRYPTION_KEY=… ENCRYPTION_KEY=… npx tsx --tsconfig tsconfig.json scripts/reseal.ts --dry-run
 *   OLD_ENCRYPTION_KEY=… ENCRYPTION_KEY=… npx tsx --tsconfig tsconfig.json scripts/reseal.ts
 * The dry run reports counts only (per column: under the old key, already new, unreadable, plain) and writes nothing. The
 * real run opens each value with the old key and seals it with the new one, in batches; values readable under neither key
 * are reported and left as they are. Never prints a value. Run against staging first.
 */
import { eq } from "drizzle-orm";

const DRY = process.argv.includes("--dry-run");
const BATCH = 200;

async function main() {
  const oldKey = process.env.OLD_ENCRYPTION_KEY ?? "";
  const newKey = process.env.ENCRYPTION_KEY ?? "";
  if (oldKey.length < 32) throw new Error("OLD_ENCRYPTION_KEY (32+ characters) is required: the key the values are sealed under today.");
  if (newKey.length < 32) throw new Error("ENCRYPTION_KEY (32+ characters) is required: the key to seal under.");
  if (oldKey === newKey) throw new Error("OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are the same key; nothing to do.");
  const { db, schema } = await import("@/db");
  const { openWith, sealWith } = await import("@/lib/crypto");
  const { RESEAL_COLUMNS, classifySealed, countLine, emptyCount } = await import("@/lib/engine/reseal");

  let totalOld = 0;
  let totalUnreadable = 0;
  for (const col of RESEAL_COLUMNS) {
    const table = (schema as unknown as Record<string, unknown>)[col.table] as typeof schema.memberships;
    const column = (table as unknown as Record<string, typeof schema.memberships.id>)[col.column];
    if (!table || !column) throw new Error(`unknown column ${col.table}.${col.column}`);
    const rows = (await db.select({ id: table.id, value: column }).from(table)) as { id: string; value: unknown }[];
    const c = emptyCount();
    const updates: { id: string; value: unknown }[] = [];
    for (const r of rows) {
      if (col.json) {
        // integrations.config: a JSON object whose secret fields are sealed strings; each is counted and re-sealed in place.
        const cfg = (r.value ?? {}) as Record<string, string>;
        let changed = false;
        const next: Record<string, string> = { ...cfg };
        for (const [k, v] of Object.entries(cfg)) {
          const state = classifySealed(v, openWith(v, oldKey) !== null, openWith(v, newKey) !== null);
          c[state]++;
          if (state === "old") {
            next[k] = sealWith(openWith(v, oldKey), newKey) ?? v;
            changed = true;
          }
        }
        if (changed) updates.push({ id: r.id, value: next });
        continue;
      }
      const v = typeof r.value === "string" ? r.value : null;
      const state = classifySealed(v, openWith(v, oldKey) !== null, openWith(v, newKey) !== null);
      c[state]++;
      if (state === "old") updates.push({ id: r.id, value: sealWith(openWith(v, oldKey), newKey) });
    }
    totalOld += c.old;
    totalUnreadable += c.unreadable;
    console.log(countLine(col.what, c));
    if (DRY || !updates.length) continue;
    for (let i = 0; i < updates.length; i += BATCH) {
      for (const u of updates.slice(i, i + BATCH)) await db.update(table).set({ [col.column]: u.value } as Record<string, unknown>).where(eq(table.id, u.id));
    }
    console.log(`  re-sealed ${updates.length} row(s) of ${col.table}.${col.column}`);
  }
  console.log(DRY ? `dry run: ${totalOld} value(s) would be re-sealed, ${totalUnreadable} unreadable under either key; nothing written` : `done: ${totalOld} value(s) re-sealed, ${totalUnreadable} left unreadable (the member is asked to paste again)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
